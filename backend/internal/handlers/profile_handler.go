package handlers

import (
	"net/http"
	"strings"

	"github.com/classo/backend/internal/config"
	"github.com/classo/backend/internal/middleware"
	"github.com/classo/backend/internal/models"
	"github.com/classo/backend/internal/repository"
)

// ProfileHandler serves the authenticated user's own profile. Credential
// management (email/password) lives in Supabase Auth; the backend only needs to
// read and enrich the local profile mirror.
type ProfileHandler struct {
	repo *repository.Repo
	cfg  *config.Config
}

// NewProfileHandler wires a ProfileHandler with its dependencies.
func NewProfileHandler(repo *repository.Repo, cfg *config.Config) *ProfileHandler {
	return &ProfileHandler{repo: repo, cfg: cfg}
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

// Promote flips the current user's global role to "instructor" when their
// email is on the INSTRUCTOR_EMAILS allowlist. Registration stays student-only;
// this is the manual promotion path.
func (h *ProfileHandler) Promote(w http.ResponseWriter, r *http.Request) {
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

	if !h.emailAllowed(profile.Email) {
		writeError(w, http.StatusForbidden, "email is not authorized for instructor access")
		return
	}

	saved, err := h.repo.SetProfileRole(r.Context(), userID, models.RoleInstructor)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to promote profile")
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

// emailAllowed reports whether the given email is on the configured instructor
// allowlist. An empty allowlist means promotion is disabled.
func (h *ProfileHandler) emailAllowed(email string) bool {
	if len(h.cfg.InstructorEmails) == 0 {
		return false
	}
	email = strings.ToLower(strings.TrimSpace(email))
	for _, allowed := range h.cfg.InstructorEmails {
		if allowed == email {
			return true
		}
	}
	return false
}
