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
	"strconv"
	"strings"
	"time"

	"github.com/classo/backend/internal/config"
	"github.com/classo/backend/internal/middleware"
	"github.com/classo/backend/internal/models"
	"github.com/classo/backend/internal/repository"
)

// urlTokenTTL is how long a proxied download URL stays valid.
const urlTokenTTL = time.Hour

// maxUploadBytes caps a single vault file upload at 20 MiB.
const maxUploadBytes = 20 << 20

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

	// A client may override the display name (so the user can rename before
	// upload); otherwise fall back to the chosen file's filename. The original
	// extension is preserved when the override omits one.
	name := sanitizeName(header.Filename)
	if renamed := strings.TrimSpace(r.FormValue("name")); renamed != "" {
		name = ensureExtension(renamed, header.Filename)
	}
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

// renameFileRequest is the payload for renaming a vault file.
type renameFileRequest struct {
	Name string `json:"name"`
}

// Rename updates a file's display name. Member or course owner only.
func (h *FileHandler) Rename(w http.ResponseWriter, r *http.Request) {
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

	var req renameFileRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	name := ensureExtension(req.Name, record.Name)
	if name == "" || name == "upload.bin" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	updated, err := h.repo.RenameFile(r.Context(), fileID, name)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "file not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to rename file")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// Delete removes a file's metadata row and its storage object. The metadata is
// deleted first so a storage failure never leaves a dangling DB reference.
func (h *FileHandler) Delete(w http.ResponseWriter, r *http.Request) {
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

	deleted, err := h.repo.DeleteFile(r.Context(), fileID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "file not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete file")
		return
	}

	// Best-effort removal of the storage object; the metadata is already gone.
	if err := h.storage.Delete(r.Context(), deleted.StoragePath); err != nil {
		// Log but don't fail the request — the file is no longer visible.
		fmt.Printf("Delete: failed to remove storage object %s: %v\n", deleted.StoragePath, err)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// URL returns a short-lived backend download URL for a single file so the
// frontend can preview (images/PDFs/text) or trigger a download. The URL is
// proxied through /download to keep the private vault bucket's bytes off a
// public Supabase URL. Member or course owner only.
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

	token := h.storage.signDownloadToken(record.ID)
	downloadURL := fmt.Sprintf("/v1/groups/%s/files/%s/download?token=%s", record.GroupID, record.ID, url.QueryEscape(token))
	writeJSON(w, http.StatusOK, map[string]string{"url": downloadURL, "name": record.Name, "mimeType": record.MimeType})
}

// Download streams a vault file's bytes to the client after validating a
// short-lived token in the query string (so <img>/<iframe>/downloads work
// without an Authorization header). The bytes are fetched from the private
// vault bucket using the service-role key.
func (h *FileHandler) Download(w http.ResponseWriter, r *http.Request) {
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

	// Validate the short-lived token first (no membership DB check needed here:
	// only a request that already passed membership can mint a valid token).
	if !h.storage.verifyDownloadToken(record.ID, r.URL.Query().Get("token")) {
		writeError(w, http.StatusForbidden, "invalid or expired download link")
		return
	}

	data, mime, err := h.storage.Download(r.Context(), record.StoragePath)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to fetch file: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", firstNonEmpty(mime, "application/octet-stream"))
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	// Inline preview for images/PDFs/text; attachment for the rest so the
	// browser offers a download rather than rendering arbitrary bytes.
	if isPreviewable(mime) {
		w.Header().Set("Content-Disposition", "inline; filename=\""+sanitizeName(record.Name)+"\"")
	} else {
		w.Header().Set("Content-Disposition", "attachment; filename=\""+sanitizeName(record.Name)+"\"")
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// isPreviewable reports whether a MIME type should render inline in the browser.
func isPreviewable(mime string) bool {
	return strings.HasPrefix(mime, "image/") ||
		mime == "application/pdf" ||
		strings.HasPrefix(mime, "text/")
}

// firstNonEmpty returns the first non-empty string, else fallback.
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
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

// ensureExtension keeps a renamed file's type intact: when the user types a new
// name without an extension, the original file's extension is re-appended so the
// MIME type (and preview/download handling) is never lost. A name that already
// carries any extension is left as-is.
func ensureExtension(newName, originalName string) string {
	newName = sanitizeName(newName)
	if newName == "" || newName == "upload.bin" {
		return newName
	}
	if filepath.Ext(newName) != "" {
		return newName
	}
	if ext := filepath.Ext(sanitizeName(originalName)); ext != "" {
		return newName + ext
	}
	return newName
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

// Download fetches a vault object's bytes from the private bucket using the
// service-role key, returning the data and its MIME type.
func (s *StorageClient) Download(ctx context.Context, path string) ([]byte, string, error) {
	if s.baseURL == "" || s.serviceKey == "" {
		return nil, "", fmt.Errorf("storage not configured")
	}

	objectPath := strings.TrimPrefix(path, storageBucket+"/")
	u := fmt.Sprintf("%s/storage/v1/object/authenticated/%s/%s", s.baseURL, storageBucket, escapeObjectPath(objectPath))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.serviceKey)

	resp, err := s.http.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, "", fmt.Errorf("storage download failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}
	return data, resp.Header.Get("Content-Type"), nil
}

// Delete removes a vault object from the private bucket by its storage path
// ("{bucket}/{objectKey}").
func (s *StorageClient) Delete(ctx context.Context, path string) error {
	if s.baseURL == "" || s.serviceKey == "" {
		return fmt.Errorf("storage not configured")
	}

	objectPath := strings.TrimPrefix(path, storageBucket+"/")
	u := fmt.Sprintf("%s/storage/v1/object/%s/%s", s.baseURL, storageBucket, escapeObjectPath(objectPath))
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.serviceKey)

	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("storage delete failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

// downloadTokenSecret derives an HMAC key for proxied-download tokens from the
// service-role key (already server-only and high-entropy).
func (s *StorageClient) downloadTokenSecret() []byte {
	return []byte("classo.download." + s.serviceKey)
}

// signDownloadToken mints a short-lived HMAC token binding a file id. The path
// is intentionally NOT embedded (it is re-read from the database on download),
// so filenames containing "." cannot corrupt the "part.delimiter" format below.
func (s *StorageClient) signDownloadToken(fileID string) string {
	exp := time.Now().Add(urlTokenTTL).Unix()
	msg := fileID + "." + strconv.FormatInt(exp, 10)
	mac := hmac.New(sha256.New, s.downloadTokenSecret())
	mac.Write([]byte(msg))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return msg + "." + sig
}

// verifyDownloadToken checks a token's signature and expiry against a file id.
func (s *StorageClient) verifyDownloadToken(fileID, token string) bool {
	if token == "" {
		return false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return false
	}
	if parts[0] != fileID {
		return false
	}
	exp, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return false
	}
	msg := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, s.downloadTokenSecret())
	mac.Write([]byte(msg))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(parts[2]), []byte(expected))
}