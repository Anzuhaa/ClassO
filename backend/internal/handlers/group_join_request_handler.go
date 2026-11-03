package handlers

import (
	"net/http"

	"github.com/classo/backend/internal/repository"
)

// ListJoinRequests returns the pending group-change requests for a course so
// the instructor can approve or reject them. Instructor-only. The path id is
// the course id.
func (h *GroupHandler) ListJoinRequests(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	if !h.requireCourseInstructor(w, r, courseID) {
		return
	}

	reqs, err := h.repo.ListPendingJoinRequests(r.Context(), courseID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list requests")
		return
	}
	writeJSON(w, http.StatusOK, reqs)
}

// ApproveJoinRequest resolves a pending request as approved, moving the student
// into the target group (or leaving them group-less on a leave request).
// Instructor-only.
func (h *GroupHandler) ApproveJoinRequest(w http.ResponseWriter, r *http.Request) {
	h.resolveJoinRequest(w, r, true)
}

// RejectJoinRequest resolves a pending request as rejected. Instructor-only.
func (h *GroupHandler) RejectJoinRequest(w http.ResponseWriter, r *http.Request) {
	h.resolveJoinRequest(w, r, false)
}

// resolveJoinRequest applies an approve/reject decision to a request, enforcing
// that the current user is an instructor for the request's course.
func (h *GroupHandler) resolveJoinRequest(w http.ResponseWriter, r *http.Request, approve bool) {
	requestID := r.PathValue("requestId")

	// Load the request first to learn its course, then authorize.
	reqRow, err := h.repo.GetJoinRequest(r.Context(), requestID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "request not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load request")
		return
	}
	if !h.requireCourseInstructor(w, r, reqRow.CourseID) {
		return
	}

	resolved, err := h.repo.ResolveJoinRequest(r.Context(), requestID, approve)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "request not found or already resolved")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to resolve request")
		return
	}
	writeJSON(w, http.StatusOK, resolved)
}