package handlers

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/classo/backend/internal/config"
	"github.com/classo/backend/internal/middleware"
	"github.com/classo/backend/internal/models"
	"github.com/classo/backend/internal/repository"
)

// maxUploadBytes caps a single vault file upload at 15 MiB, keeping the
// memory-optimized backend bounded while matching Supabase's typical default.
const maxUploadBytes = 15 << 20

// FileHandler serves file-vault uploads and metadata listings.
type FileHandler struct {
	repo *repository.Repo
	cfg  *config.Config
}

// NewFileHandler wires a FileHandler with its dependencies.
func NewFileHandler(repo *repository.Repo, cfg *config.Config) *FileHandler {
	return &FileHandler{repo: repo, cfg: cfg}
}

// Upload stores a multipart file. In this scaffold the bytes are written to a
// local per-group directory and only metadata is recorded in PostgreSQL; a
// production deployment should stream to Supabase Storage and persist only the
// storage_path (the row shape already supports that).
func (h *FileHandler) Upload(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	userID := middleware.UserID(r.Context())

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

	storagePath := filepath.Join(".", "vault", groupID, sanitizeName(header.Filename))
	if err := writeLocalFile(storagePath, file); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store file")
		return
	}

	record, err := h.repo.CreateFile(r.Context(), models.File{
		GroupID:     groupID,
		UploaderID:  userID,
		Name:        header.Filename,
		StoragePath: storagePath,
		Size:        header.Size,
		MimeType:    header.Header.Get("Content-Type"),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save file metadata")
		return
	}
	writeJSON(w, http.StatusCreated, record)
}

// List returns the group's vault files.
func (h *FileHandler) List(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	files, err := h.repo.ListFiles(r.Context(), groupID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list files")
		return
	}
	writeJSON(w, http.StatusOK, files)
}

// sanitizeName strips path separators and traversal sequences from an
// uploaded filename to keep storage writes within the group directory.
func sanitizeName(name string) string {
	name = filepath.Base(name)
	name = strings.ReplaceAll(name, "..", "")
	name = strings.TrimSpace(name)
	if name == "" || name == "." {
		return "upload.bin"
	}
	return name
}

// writeLocalFile copies src onto disk at path, creating parent directories.
func writeLocalFile(path string, src io.Reader) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	dst, err := os.Create(path)
	if err != nil {
		return err
	}
	defer dst.Close()
	_, err = io.Copy(dst, src)
	return err
}
