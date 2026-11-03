package handlers

import (
	"net/http"

	"github.com/classo/backend/internal/repository"
)

// lockCourseRequest toggles the course's group-membership lock.
type lockCourseRequest struct {
	Locked bool `json:"locked"`
}

// SetLock toggles the instructor-controlled lock that, when on, forces students
// to request (instead of directly making) group joins, switches, and leaves.
func (h *CourseHandler) SetLock(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	if !h.requireInstructor(w, r, courseID) {
		return
	}
	var req lockCourseRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	course, err := h.repo.SetCourseLocked(r.Context(), courseID, req.Locked)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "course not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update lock")
		return
	}
	writeJSON(w, http.StatusOK, course)
}