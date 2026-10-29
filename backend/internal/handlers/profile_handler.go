package handlers

import (
	"net/http"
	"strings"

	"github.com/classo/backend/internal/middleware"
	"github.com/classo/backend/internal/models"
	"github.com/classo/backend/internal/repository"
)

// ProfileHandler serves the authenticated user's own profile. Credential
// management (email/password) lives in Supabase Auth; the backend only needs to
// read and enrich the local profile mirror.
type ProfileHandler struct {
	repo *repository.Repo
}

// NewProfileHandler wires a ProfileHandler with its dependencies.
func NewProfileHandler(repo *repository.Repo) *ProfileHandler {
	return &ProfileHandler{repo: repo}
}

// Me returns the profile identified by the current request's user id (from the
// verified Supabase JWT, or the demo user when ALLOW_NO_AUTH is enabled).
func (h *ProfileHandler) Me(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserID(r.Context())
	profile, err := h.repo.GetProfile(r.Context(), userID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "profile not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load profile")
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

// updateProfileRequest is the payload for updating the current user's profile.
type updateProfileRequest struct {
	FullName string `json:"fullName"`
	Role     string `json:"role"`
}

// Update lets the current user set their display name and role. Email is owned
// by Supabase Auth and cannot be changed here.
func (h *ProfileHandler) Update(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserID(r.Context())
	var req updateProfileRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	current, err := h.repo.GetProfile(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load profile")
		return
	}

	fullName := strings.TrimSpace(req.FullName)
	if fullName == "" {
		fullName = current.FullName
	}
	role := req.Role
	if role != models.RoleInstructor && role != models.RoleStudent {
		role = current.Role
	}

	p := models.Profile{
		ID:        userID,
		FullName:  fullName,
		Email:     current.Email,
		AvatarURL: current.AvatarURL,
		Role:      role,
	}
	if err := h.repo.UpsertProfile(r.Context(), p); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save profile")
		return
	}

	saved, err := h.repo.GetProfile(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to reload profile")
		return
	}
	writeJSON(w, http.StatusOK, saved)
}