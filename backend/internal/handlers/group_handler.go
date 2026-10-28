package handlers

import (
	"net/http"
	"time"

	"github.com/classo/backend/internal/middleware"
	"github.com/classo/backend/internal/models"
	"github.com/classo/backend/internal/repository"
	"github.com/classo/backend/internal/services"
)

// GroupHandler serves chat, task, vault, and summary endpoints scoped to a
// single group workspace.
type GroupHandler struct {
	repo    *repository.Repo
	summary *services.SummaryService
}

// NewGroupHandler wires a GroupHandler with its dependencies.
func NewGroupHandler(repo *repository.Repo, summary *services.SummaryService) *GroupHandler {
	return &GroupHandler{repo: repo, summary: summary}
}

// Members returns the profiles of everyone in a group, used to render the
// member list and populate task assignees.
func (h *GroupHandler) Members(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	members, err := h.repo.ListProfilesByGroup(r.Context(), groupID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list members")
		return
	}
	writeJSON(w, http.StatusOK, members)
}

// Join adds the current user to a group as a "member", enforcing the one-
// group-per-course rule and a size cap (the course's group_size). Idempotent
// when the user is already in this exact group.
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

	// Reject if the user is already in another group within this course.
	existing, err := h.repo.GroupInCourseForUser(r.Context(), group.CourseID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check membership")
		return
	}
	if existing != "" && existing != groupID {
		writeError(w, http.StatusConflict, "you are already in another group in this course")
		return
	}

	// Reject if the group is full (current size reaches the course group_size).
	course, err := h.repo.GetCourse(r.Context(), group.CourseID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load course")
		return
	}
	if existing == "" { // skip size check if already a member (re-join no-op)
		count, err := h.repo.CountGroupMembers(r.Context(), groupID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to count members")
			return
		}
		if count >= course.GroupSize {
			writeError(w, http.StatusConflict, "group is full")
			return
		}
	}

	if err := h.repo.JoinGroup(r.Context(), groupID, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to join group")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "groupId": groupID})
}

// createMessageRequest is the payload for posting a chat message.
type createMessageRequest struct {
	Content string `json:"content"`
}

// Messages lists recent chat messages for a group.
func (h *GroupHandler) Messages(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	messages, err := h.repo.ListMessages(r.Context(), groupID, 200)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list messages")
		return
	}
	writeJSON(w, http.StatusOK, messages)
}

// SendMessage creates a chat message from the current user.
func (h *GroupHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	userID := middleware.UserID(r.Context())
	var req createMessageRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}

	msg, err := h.repo.CreateMessage(r.Context(), models.Message{
		GroupID:  groupID,
		SenderID: userID,
		Content:  req.Content,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to send message")
		return
	}
	writeJSON(w, http.StatusCreated, msg)
}

// Tasks lists all tasks in the group's board.
func (h *GroupHandler) Tasks(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	tasks, err := h.repo.ListTasks(r.Context(), groupID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list tasks")
		return
	}
	writeJSON(w, http.StatusOK, tasks)
}

// createTaskRequest is the payload for creating a task.
type createTaskRequest struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	AssigneeID  *string `json:"assigneeId"`
	DueDate     *string `json:"dueDate"`
}

// CreateTask inserts a new task in the group's board.
func (h *GroupHandler) CreateTask(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	userID := middleware.UserID(r.Context())
	var req createTaskRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	var due *time.Time
	if req.DueDate != nil && *req.DueDate != "" {
		t, err := parseTime(*req.DueDate)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid dueDate (expected RFC3339)")
			return
		}
		due = &t
	}

	task, err := h.repo.CreateTask(r.Context(), models.Task{
		GroupID:     groupID,
		Title:       req.Title,
		Description: req.Description,
		AssigneeID:  req.AssigneeID,
		Status:      models.TaskStatusTodo,
		DueDate:     due,
		CreatedBy:   &userID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create task")
		return
	}
	writeJSON(w, http.StatusCreated, task)
}

// updateTaskStatusRequest is the payload for moving a task between columns.
type updateTaskStatusRequest struct {
	Status string `json:"status"`
}

// UpdateTaskStatus moves a task to a new status column.
func (h *GroupHandler) UpdateTaskStatus(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	taskID := r.PathValue("taskId")
	var req updateTaskStatusRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	switch req.Status {
	case models.TaskStatusTodo, models.TaskStatusInProgress, models.TaskStatusDone:
	default:
		writeError(w, http.StatusBadRequest, "invalid status")
		return
	}

	if err := h.repo.UpdateTaskStatus(r.Context(), taskID, groupID, req.Status); err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "task not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update task")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": req.Status})
}

// Summarize generates (or returns the latest) AI summary for the group chat.
func (h *GroupHandler) Summarize(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")

	// Manual button triggers a fresh summary.
	summary, err := h.summary.Generate(r.Context(), groupID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to summarize")
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

// LatestSummary returns the most recent summary without regenerating.
func (h *GroupHandler) LatestSummary(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	summary, err := h.summary.Latest(r.Context(), groupID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeJSON(w, http.StatusOK, nil)
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load summary")
		return
	}
	writeJSON(w, http.StatusOK, summary)
}
