package handlers

import (
	"bytes"
	"context"
	"encoding/json"
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
		// Surface the underlying storage error (missing bucket, bad key, etc.) so
		// the failure is diagnosable instead of a generic 500.
		writeError(w, http.StatusBadGateway, "failed to store file: "+err.Error())
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
		// Surface the underlying storage error (missing bucket, bad key, etc.)
		// so the failure is diagnosable instead of a generic 500.
		writeError(w, http.StatusBadGateway, "failed to sign URL: "+err.Error())
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
	baseURL    string
	serviceKey string
	http       *http.Client
}

// NewStorageClient builds a StorageClient from config.
func NewStorageClient(cfg *config.Config) *StorageClient {
	return &StorageClient{
		baseURL:    strings.TrimSuffix(cfg.SupabaseURL, "/"),
		serviceKey: cfg.SupabaseServiceKey,
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

	u := fmt.Sprintf("%s/storage/v1/object/%s/%s", s.baseURL, storageBucket, escapeObjectPath(objectKey))
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

// escapeObjectPath URL-encodes each path segment of an object key, preserving
// "/" as the hierarchy separator. url.PathEscape would turn "/" into %2F,
// collapsing "{groupID}/{name}" into a single flat object name.
func escapeObjectPath(objectKey string) string {
	segs := strings.Split(objectKey, "/")
	for i, seg := range segs {
		segs[i] = url.PathEscape(seg)
	}
	return strings.Join(segs, "/")
}

// CreateSignedURL asks Supabase Storage to mint a signed URL for an object via
// its server-side sign endpoint, authenticated with the service-role key. The
// returned URL is short-lived and grants temporary access without exposing any
// secret to the client.
func (s *StorageClient) CreateSignedURL(ctx context.Context, path string, expires time.Duration) (string, error) {
	if s.baseURL == "" || s.serviceKey == "" {
		return "", fmt.Errorf("storage not configured")
	}

	// path may already include the bucket prefix or be just the object key.
	objectPath := strings.TrimPrefix(path, storageBucket+"/")

	// The sign endpoint expects a JSON body with the desired expiry in seconds.
	body, err := json.Marshal(map[string]any{"expiresIn": int(expires.Seconds())})
	if err != nil {
		return "", err
	}

	u := fmt.Sprintf("%s/storage/v1/object/sign/%s/%s", s.baseURL, storageBucket, escapeObjectPath(objectPath))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.serviceKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("signed url request failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	// Supabase returns the URL under "signedURL" (current API) or "signedUrl"
	// (older); accept either so a casing change can't break downloads.
	var out struct {
		SignedURL string `json:"signedURL"`
		SignedUrl string `json:"signedUrl"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", fmt.Errorf("signed url response unparsable: %s", strings.TrimSpace(string(respBody)))
	}
	signed := out.SignedURL
	if signed == "" {
		signed = out.SignedUrl
	}
	if signed == "" {
		return "", fmt.Errorf("signed url response missing signedURL: %s", strings.TrimSpace(string(respBody)))
	}
	// Supabase returns a protocol-relative path (e.g. "/object/sign/..."); make it
	// absolute so the browser can fetch it directly without the app's proxy.
	if strings.HasPrefix(signed, "/") {
		signed = s.baseURL + signed
	}
	return signed, nil
}