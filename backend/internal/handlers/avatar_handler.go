// Avatar upload: stores a profile picture in the Supabase Storage "avatars"
// bucket (public) and persists the resulting URL to profiles.avatar_url.
package handlers

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/classo/backend/internal/config"
	"github.com/classo/backend/internal/middleware"
	"github.com/classo/backend/internal/repository"
)

// maxAvatarBytes caps an avatar upload at 4 MiB.
const maxAvatarBytes = 4 << 20

// allowedAvatarTypes are the only accepted image MIME types for an avatar.
var allowedAvatarTypes = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
}

// avatarStorageBucket is the public Supabase Storage bucket avatars live in.
const avatarStorageBucket = "avatars"

// UploadAvatar handles a multipart image upload for the current user's avatar.
// It enforces the 4 MiB size limit and image-type allowlist, stores the bytes in
// the public avatars bucket, and writes the public URL to profiles.avatar_url.
func (h *ProfileHandler) UploadAvatar(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserID(r.Context())

	if h.cfg.SupabaseURL == "" || h.cfg.SupabaseServiceKey == "" {
		writeError(w, http.StatusInternalServerError, "storage is not configured")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarBytes)
	if err := r.ParseMultipartForm(maxAvatarBytes); err != nil {
		writeError(w, http.StatusBadRequest, "image too large (max 4MB) or malformed")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	contentType := header.Header.Get("Content-Type")
	ext, ok := allowedAvatarTypes[contentType]
	if !ok {
		writeError(w, http.StatusBadRequest, "unsupported image type (use PNG, JPEG, or WebP)")
		return
	}

	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read image")
		return
	}
	if len(data) > maxAvatarBytes {
		writeError(w, http.StatusBadRequest, "image too large (max 4MB)")
		return
	}

	// Object key = {userID}{ext}, deterministic so re-uploads overwrite.
	objectKey := userID + ext

	if err := uploadAvatarBytes(r.Context(), h.cfg, objectKey, data, contentType); err != nil {
		// Surface the underlying storage error so a 404 (missing bucket) or 401
		// (bad key) is diagnosable rather than hidden behind a generic message.
		writeError(w, http.StatusBadGateway, "failed to store avatar: "+err.Error())
		return
	}

	publicURL := fmt.Sprintf("%s/storage/v1/object/public/%s/%s",
		strings.TrimSuffix(h.cfg.SupabaseURL, "/"), avatarStorageBucket, url.PathEscape(objectKey))

	saved, err := h.repo.SetProfileAvatarURL(r.Context(), userID, publicURL)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "profile not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to save avatar")
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

// uploadAvatarBytes PUTs image bytes to the public avatars bucket using the
// service-role key (server-side only; the key never leaves the backend).
func uploadAvatarBytes(ctx context.Context, cfg *config.Config, objectKey string, data []byte, mime string) error {
	u := fmt.Sprintf("%s/storage/v1/object/%s/%s",
		strings.TrimSuffix(cfg.SupabaseURL, "/"), avatarStorageBucket, url.PathEscape(objectKey))

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.SupabaseServiceKey)
	req.Header.Set("Content-Type", mime)
	req.Header.Set("x-upsert", "true")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("avatar upload failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}
