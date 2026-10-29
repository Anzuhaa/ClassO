package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/classo/backend/internal/middleware"
	"github.com/classo/backend/internal/models"
	"github.com/classo/backend/internal/repository"
)

// GroupHandler serves group workspace chat and task endpoints. Membership and
// lifecycle endpoints live in group_member_handler.go.
type GroupHandler struct {
	repo *repository.Repo
}

// NewGroupHandler wires a GroupHandler with its dependencies.
func NewGroupHandler(repo *repository.Repo) *GroupHandler {
	return &GroupHandler{repo: repo}
}

// createMessageRequest is the payload for posting a chat message.
type createMessageRequest struct {
	Content string `json:"content"`
}

// Messages lists recent chat messages for a group. Member or course owner only.
func (h *GroupHandler) Messages(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	if !h.requireGroupMember(w, r, groupID) {
		return
	}
	messages, err := h.repo.ListMessages(r.Context(), groupID, 300)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list messages")
		return
	}
	writeJSON(w, http.StatusOK, messages)
}

// SendMessage creates a chat message from the current user. Member only.
func (h *GroupHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	if !h.requireGroupMember(w, r, groupID) {
		return
	}
	userID := middleware.UserID(r.Context())
	var req createMessageRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Content) == "" {
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

// Tasks lists all tasks in the group's board. Member or course owner only.
func (h *GroupHandler) Tasks(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	if !h.requireGroupMember(w, r, groupID) {
		return
	}
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
	if !h.requireGroupMember(w, r, groupID) {
		return
	}
	userID := middleware.UserID(r.Context())
	var req createTaskRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Title) == "" {
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
	if !h.requireGroupMember(w, r, groupID) {
		return
	}
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
// requireGroupMember enforces that the current user is a group member or owns
// the course containing the group, writing 403 otherwise.
func (h *GroupHandler) requireGroupMember(w http.ResponseWriter, r *http.Request, groupID string) bool {
	userID := middleware.UserID(r.Context())
	ok, err := h.repo.IsGroupMember(r.Context(), groupID, userID)
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
