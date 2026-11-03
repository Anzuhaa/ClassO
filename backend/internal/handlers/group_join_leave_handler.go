package handlers

import (
	"net/http"

	"github.com/classo/backend/internal/middleware"
	"github.com/classo/backend/internal/repository"
)

// Student group join/leave endpoints, gated by the course's membership lock.
// When the course is locked these file an instructor-approval request instead
// of mutating group_members directly (see group_join_request_handler.go).

// Join adds the current user to a group as a "member", enforcing the one-
// group-per-course rule (DB unique constraint) and per-group capacity. When the
// course is locked, this instead files an instructor-approval request.
func (h *GroupHandler) Join(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	userID := middleware.UserID(r.Context())

	group, err := h.repo.GetGroup(r.Context(), groupID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "group not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load group")
		return
	}

	// Locked course: don't join directly; file a request for the instructor.
	course, err := h.repo.GetCourse(r.Context(), group.CourseID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load course")
		return
	}
	if course.Locked {
		req, err := h.repo.UpsertJoinRequest(r.Context(), group.CourseID, userID, &groupID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to request join")
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "pending", "requestId": req.ID})
		return
	}

	existing, err := h.repo.GroupInCourseForUser(r.Context(), group.CourseID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check membership")
		return
	}
	if existing != "" && existing != groupID {
		writeError(w, http.StatusConflict, "you are already in another group in this course")
		return
	}

	if existing == "" {
		count, err := h.repo.CountGroupMembers(r.Context(), groupID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to count members")
			return
		}
		if count >= group.Capacity {
			writeError(w, http.StatusConflict, "group is full")
			return
		}
	}

	if err := h.repo.JoinGroup(r.Context(), groupID, group.CourseID, userID); err != nil {
		if repository.IsUniqueViolation(err) {
			writeError(w, http.StatusConflict, "you are already in another group in this course")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to join group")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "groupId": groupID})
}

// LeaveGroup removes the current user from a group (student action). When the
// course is locked this files an instructor-approval request instead of
// removing the membership immediately.
func (h *GroupHandler) LeaveGroup(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	userID := middleware.UserID(r.Context())

	group, err := h.repo.GetGroup(r.Context(), groupID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "group not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load group")
		return
	}

	course, err := h.repo.GetCourse(r.Context(), group.CourseID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load course")
		return
	}
	if course.Locked {
		req, err := h.repo.UpsertJoinRequest(r.Context(), group.CourseID, userID, nil)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to request leave")
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "pending", "requestId": req.ID})
		return
	}

	if err := h.repo.RemoveGroupMember(r.Context(), groupID, userID); err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "membership not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to leave group")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}