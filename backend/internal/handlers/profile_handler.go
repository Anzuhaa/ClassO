package handlers

import (
	"net/http"
	"strings"

	"github.com/classo/backend/internal/middleware"
	"github.com/classo/backend/internal/models"
	"github.com/classo/backend/internal/repository"
)

// ProfileHandler serves profile creation/selection for the fast demo switcher
// (Feature 1). In production the Auth middleware resolves identity from a
// Supabase JWT; in demo mode, the frontend picks a profile id and sends it via
// the X-User-ID header, which Auth resolves against the profiles table.
type ProfileHandler struct {
	repo *repository.Repo
}

// NewProfileHandler wires a ProfileHandler with its dependencies.
func NewProfileHandler(repo *repository.Repo) *ProfileHandler {
	return &ProfileHandler{repo: repo}
}

// List returns every profile, letting the switcher offer existing profiles.
func (h *ProfileHandler) List(w http.ResponseWriter, r *http.Request) {
	profiles, err := h.repo.ListProfiles(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list profiles")
		return
	}
	writeJSON(w, http.StatusOK, profiles)
}

// Me returns the profile identified by the current request's user id (from the
// X-User-ID header in demo mode, or the JWT sub in production).
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

// createProfileRequest is the payload for creating/selecting a profile.
type createProfileRequest struct {
	ID       string   `json:"id"` // optional; auto-generated when empty
	FullName string   `json:"fullName"`
	Role     string   `json:"role"` // instructor | student
	Skills   []string `json:"skills"`
}

// Create inserts (or updates) a profile and returns it. The frontend persists
// the returned id to localStorage and sends it as X-User-ID thereafter.
func (h *ProfileHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createProfileRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	fullName := strings.TrimSpace(req.FullName)
	if fullName == "" {
		writeError(w, http.StatusBadRequest, "fullName is required")
		return
	}
	role := req.Role
	if role == "" {
		role = models.RoleStudent
	}
	if role != models.RoleInstructor && role != models.RoleStudent {
		writeError(w, http.StatusBadRequest, "role must be instructor or student")
		return
	}
	skills := req.Skills
	if skills == nil {
		skills = []string{}
	}

	// Reuse the caller's active identity when no explicit id is given, so the
	// switcher can update the current profile in place.
	id := req.ID
	if id == "" {
		id = middleware.UserID(r.Context())
	}

	p := models.Profile{
		ID:       id,
		FullName: fullName,
		Email:    id + "@classo.local",
		Skills:   skills,
		Role:     role,
	}
	if err := h.repo.UpsertProfile(r.Context(), p); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save profile")
		return
	}

	saved, err := h.repo.GetProfile(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to reload profile")
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}