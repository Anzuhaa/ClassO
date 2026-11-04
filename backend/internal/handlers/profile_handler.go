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

// CheckUsername reports whether a username is available for registration. It is
// unauthenticated (called before an account exists) and answers a case-
// insensitive, whitespace-trimmed uniqueness query against profiles.username.
//
// Returns 200 `{available:true}` when free, or 409 `{available:false}` when the
// username is already taken — the 409 also serves as the conflict signal the
// registration form treats as a hard "username already taken" failure.
func (h *ProfileHandler) CheckUsername(w http.ResponseWriter, r *http.Request) {
	username := strings.TrimSpace(r.URL.Query().Get("username"))
	if username == "" {
		writeError(w, http.StatusBadRequest, "username is required")
		return
	}

	taken, err := h.repo.UsernameExists(r.Context(), username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check username")
		return
	}

	if taken {
		writeJSON(w, http.StatusConflict, map[string]bool{"available": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"available": true})
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
// Only the display name is editable here; the role is deliberately omitted so a
// user cannot self-assign "instructor" via PATCH (that would bypass the
// INSTRUCTOR_EMAILS allowlist enforced in Promote, which is the sole role-
// escalation path).
type updateProfileRequest struct {
	FullName string `json:"fullName"`
}

// Update lets the current user set their display name only. Email is owned by
// Supabase Auth, and role is owned by the Promote allowlist; neither is
// mutable here.
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

	// Preserve the authoritative role and email exactly as loaded; only the
	// display name may change through this endpoint.
	p := models.Profile{
		ID:        userID,
		FullName:  fullName,
		Email:     current.Email,
		AvatarURL: current.AvatarURL,
		Role:      current.Role,
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
