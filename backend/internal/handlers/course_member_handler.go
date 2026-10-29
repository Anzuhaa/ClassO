package handlers

import (
	"net/http"

	"github.com/classo/backend/internal/middleware"
	"github.com/classo/backend/internal/models"
)

// This file holds the course-membership endpoints (roster, enroll, remove) for
// CourseHandler, keeping the main course_handler.go focused on the course and
// group-formation surface.

// addMemberRequest is the payload for enrolling a user into a course.
type addMemberRequest struct {
	UserID string `json:"userId"`
	Role   string `json:"role"`
}

// AddMember enrolls a user into a course; used for joining by code or invite.
// Instructor-only.
func (h *CourseHandler) AddMember(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	if !h.requireInstructor(w, r, courseID) {
		return
	}
	var req addMemberRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.UserID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}
	role := req.Role
	if role == "" {
		role = models.RoleStudent
	}
	if err := h.repo.AddCourseMember(r.Context(), courseID, req.UserID, role); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add member")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// RemoveMember removes a user's enrollment from a course (instructor action).
func (h *CourseHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	if !h.requireInstructor(w, r, courseID) {
		return
	}
	var req addMemberRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.UserID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}
	if err := h.repo.RemoveCourseMember(r.Context(), courseID, req.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove member")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Members returns the enrollment roster for a course. Member-only.
func (h *CourseHandler) Members(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	if !h.requireMember(w, r, courseID) {
		return
	}
	members, err := h.repo.ListCourseMembers(r.Context(), courseID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list members")
		return
	}
	writeJSON(w, http.StatusOK, members)
}

// MyGroup returns the group id the current user already belongs to within this
// course (or an empty string when they are in none).
func (h *CourseHandler) MyGroup(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	if !h.requireMember(w, r, courseID) {
		return
	}
	userID := middleware.UserID(r.Context())
	groupID, err := h.repo.GroupInCourseForUser(r.Context(), courseID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load membership")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"groupId": groupID})
}

// requireMember enforces course membership (owner or enrolled) and writes a 403
// when the user has no access. Returns true when access is granted.
func (h *CourseHandler) requireMember(w http.ResponseWriter, r *http.Request, courseID string) bool {
	userID := middleware.UserID(r.Context())
	ok, err := h.repo.IsCourseMember(r.Context(), courseID, userID)
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

// requireInstructor enforces course instructor authority (owner or courseRole
// instructor) and writes a 403 otherwise.
func (h *CourseHandler) requireInstructor(w http.ResponseWriter, r *http.Request, courseID string) bool {
	userID := middleware.UserID(r.Context())
	ok, err := h.repo.IsCourseInstructor(r.Context(), courseID, userID)
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