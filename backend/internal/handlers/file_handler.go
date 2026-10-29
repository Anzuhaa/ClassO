package handlers

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/classo/backend/internal/config"
	"github.com/classo/backend/internal/middleware"
	"github.com/classo/backend/internal/models"
	"github.com/classo/backend/internal/repository"
)

// maxUploadBytes caps a single vault file upload at 15 MiB.
const maxUploadBytes = 15 << 20

// FileHandler serves file-vault uploads, metadata listings, and signed URLs.
type FileHandler struct {
	repo    *repository.Repo
	storage *StorageClient
}

// NewFileHandler wires a FileHandler with its dependencies.
func NewFileHandler(repo *repository.Repo, cfg *config.Config) *FileHandler {
	return &FileHandler{repo: repo, storage: NewStorageClient(cfg)}
}

// Upload stores a multipart file in Supabase Storage and records its metadata
// in PostgreSQL. Only the storage path is persisted; bytes live in Storage.
func (h *FileHandler) Upload(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	userID := middleware.UserID(r.Context())

	if !h.requireGroupMember(w, r, groupID) {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, "file too large or malformed")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read file")
		return
	}

	name := sanitizeName(header.Filename)
	// Object key: {groupID}/{name}.
	objectKey := filepath.ToSlash(filepath.Join(groupID, name))

	storagePath, err := h.storage.Upload(r.Context(), objectKey, data, header.Header.Get("Content-Type"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store file")
		return
	}

	record, err := h.repo.CreateFile(r.Context(), models.File{
		GroupID:     groupID,
		UploaderID:  userID,
		Name:        name,
		StoragePath: storagePath,
		Size:        int64(len(data)),
		MimeType:    header.Header.Get("Content-Type"),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save file metadata")
		return
	}
	writeJSON(w, http.StatusCreated, record)
}

// List returns the group's vault files. Member or course owner only.
func (h *FileHandler) List(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	if !h.requireGroupMember(w, r, groupID) {
		return
	}
	files, err := h.repo.ListFiles(r.Context(), groupID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list files")
		return
	}
	writeJSON(w, http.StatusOK, files)
}

// URL returns a short-lived signed URL for a single file so the frontend can
// preview (images/PDFs/text) or trigger a download via Supabase Storage.
// Member or course owner only.
func (h *FileHandler) URL(w http.ResponseWriter, r *http.Request) {
	fileID := r.PathValue("fileId")
	record, err := h.repo.GetFile(r.Context(), fileID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "file not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load file")
		return
	}
	if !h.requireGroupMember(w, r, record.GroupID) {
		return
	}

	signed, err := h.storage.CreateSignedURL(r.Context(), record.StoragePath, time.Hour)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to sign URL")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": signed, "name": record.Name, "mimeType": record.MimeType})
}

// requireGroupMember enforces that the current user is a group member or owns
// the course containing the group, writing 403 otherwise.
func (h *FileHandler) requireGroupMember(w http.ResponseWriter, r *http.Request, groupID string) bool {
	userID := middleware.UserID(r.Context())
	ok, err := h.repo.IsGroupMember(r.Context(), groupID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check access")
		return false
	}
	if !ok {
		writeError(w, http.StatusForbidden, "forbidden")
		return false
	}
	return true
}

// sanitizeName strips path separators and traversal sequences from an
// uploaded filename to keep storage keys within the group directory.
func sanitizeName(name string) string {
	name = filepath.Base(name)
	name = strings.ReplaceAll(name, "..", "")
	name = strings.TrimSpace(name)
	if name == "" || name == "." {
		return "upload.bin"
	}
	return name
}

// StorageClient wraps the Supabase Storage REST API for uploads and signed
// URLs using the service-role key (server-side only; the key never leaves the
// backend).
type StorageClient struct {
	baseURL     string
	serviceKey  string
	jwtSecret   string
	http        *http.Client
}

// NewStorageClient builds a StorageClient from config.
func NewStorageClient(cfg *config.Config) *StorageClient {
	return &StorageClient{
		baseURL:    strings.TrimSuffix(cfg.SupabaseURL, "/"),
		serviceKey: cfg.SupabaseServiceKey,
		jwtSecret:  cfg.SupabaseJWTSecret,
		http:       &http.Client{Timeout: 60 * time.Second},
	}
}

// storageBucket is the fixed bucket all vault files live in.
const storageBucket = "vault"

// Upload stores bytes at objectKey and returns the canonical storage path
// ("{bucket}/{objectKey}").
func (s *StorageClient) Upload(ctx context.Context, objectKey string, data []byte, mime string) (string, error) {
	if s.baseURL == "" || s.serviceKey == "" {
		return "", fmt.Errorf("storage not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY)")
	}

	u := fmt.Sprintf("%s/storage/v1/object/%s/%s", s.baseURL, storageBucket, url.PathEscape(objectKey))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.serviceKey)
	if mime != "" {
		req.Header.Set("Content-Type", mime)
	} else {
		req.Header.Set("Content-Type", "application/octet-stream")
	}
	req.Header.Set("x-upsert", "true")

	resp, err := s.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return "", fmt.Errorf("storage upload failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	return storageBucket + "/" + objectKey, nil
}

// CreateSignedURL returns a short-lived signed URL for an object path. It
// signs the URL with the service-role JWT using Supabase's documented signed-
// URL scheme.
func (s *StorageClient) CreateSignedURL(ctx context.Context, path string, expires time.Duration) (string, error) {
	if s.baseURL == "" || s.serviceKey == "" || s.jwtSecret == "" {
		return "", fmt.Errorf("storage not configured")
	}

	// path may already include the bucket prefix or be just the object key.
	objectPath := strings.TrimPrefix(path, storageBucket+"/")
	exp := time.Now().Add(expires).Unix()

	token := signToken(s.jwtSecret, objectPath, exp)
	q := url.Values{}
	q.Set("token", token)

	u := fmt.Sprintf("%s/storage/v1/object/sign/%s/%s", s.baseURL, storageBucket, objectPath)
	return u + "?" + q.Encode(), nil
}

// signToken builds the JWT that Supabase Storage expects for signed URLs. It
// is an HS256 token with custom claims "url" (the object path) and "exp".
func signToken(secret, objectPath string, exp int64) string {
	header := base64URL([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload := base64URL([]byte(fmt.Sprintf(`{"url":%q,"exp":%d}`, objectPath, exp)))
	signingInput := header + "." + payload

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingInput))
	sig := mac.Sum(nil)

	return signingInput + "." + base64URL(sig)
}

// base64URL encodes bytes in raw URL-safe base64 (no padding), matching the
// encoding Supabase's signed JWT payloads use.
func base64URL(data []byte) string {
	return base64.RawURLEncoding.EncodeToString(data)
}