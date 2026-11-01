package handlers

import (
	"net/http"
	"strings"

	"github.com/classo/backend/internal/middleware"
	"github.com/classo/backend/internal/repository"
)

// This file holds the group membership and lifecycle endpoints (create, join,
// leave, remove member, delete) for GroupHandler; the chat/task endpoints stay
// in group_handler.go.

// Members returns the profiles of everyone in a group. Member or course owner only.
func (h *GroupHandler) Members(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	if !h.requireGroupMember(w, r, groupID) {
		return
	}
	members, err := h.repo.ListProfilesByGroup(r.Context(), groupID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list members")
		return
	}
	writeJSON(w, http.StatusOK, members)
}

// createGroupRequest is the payload for manual group creation (instructor).
type createGroupRequest struct {
	Name     string `json:"name"`
	Capacity int    `json:"capacity"`
	Count    int    `json:"count"`
}

// CreateGroup lets an instructor create one or more empty groups with a custom
// capacity. Instructor-only (owner or courseRole instructor).
func (h *GroupHandler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	if !h.requireCourseInstructor(w, r, courseID) {
		return
	}
	var req createGroupRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Capacity <= 0 {
		req.Capacity = 4
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "Group"
	}
	count := req.Count
	if count < 1 {
		count = 1
	}

	groups, err := h.repo.CreateGroups(r.Context(), courseID, name, req.Capacity, count)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create groups")
		return
	}
	writeJSON(w, http.StatusCreated, groups)
}

// DeleteGroup removes a group from a course (instructor action).
func (h *GroupHandler) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	group, err := h.repo.GetGroup(r.Context(), groupID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "group not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load group")
		return
	}
	if !h.requireCourseInstructor(w, r, group.CourseID) {
		return
	}
	if err := h.repo.DeleteGroup(r.Context(), groupID); err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "group not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete group")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Join adds the current user to a group as a "member", enforcing the one-
// group-per-course rule (DB unique constraint) and per-group capacity.
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

// LeaveGroup removes the current user from a group (student action).
func (h *GroupHandler) LeaveGroup(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	userID := middleware.UserID(r.Context())
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

// removeMemberRequest identifies the member to remove from a group.
type removeMemberRequest struct {
	UserID string `json:"userId"`
}

// RemoveMember removes a member from a group (instructor action).
func (h *GroupHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	group, err := h.repo.GetGroup(r.Context(), groupID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "group not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load group")
		return
	}
	if !h.requireCourseInstructor(w, r, group.CourseID) {
		return
	}
	var req removeMemberRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.UserID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}
	if err := h.repo.RemoveGroupMember(r.Context(), groupID, req.UserID); err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "membership not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to remove member")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
// renameGroupRequest is the payload for renaming a group workspace.
type renameGroupRequest struct {
	Name string `json:"name"`
}

// Get returns a single group by id. Member or course owner only.
func (h *GroupHandler) Get(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	if !h.requireGroupMember(w, r, groupID) {
		return
	}
	group, err := h.repo.GetGroup(r.Context(), groupID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "group not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load group")
		return
	}
	writeJSON(w, http.StatusOK, group)
}

// Rename updates a group's name (instructor action). The refreshed group is
// returned so the workspace header, breadcrumbs, and sidebar can resync.
func (h *GroupHandler) Rename(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	group, err := h.repo.GetGroup(r.Context(), groupID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "group not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load group")
		return
	}
	if !h.requireCourseInstructor(w, r, group.CourseID) {
		return
	}
	var req renameGroupRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	updated, err := h.repo.RenameGroup(r.Context(), groupID, name)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "group not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to rename group")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// requireCourseInstructor enforces that the current user owns the course or
// holds the instructor role within it, writing 403 otherwise.
func (h *GroupHandler) requireCourseInstructor(w http.ResponseWriter, r *http.Request, courseID string) bool {
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
