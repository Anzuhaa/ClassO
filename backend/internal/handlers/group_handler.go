package handlers

import (
	"log"
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
	hub  *ChatHub
}

// NewGroupHandler wires a GroupHandler with its dependencies.
func NewGroupHandler(repo *repository.Repo) *GroupHandler {
	return &GroupHandler{repo: repo, hub: NewChatHub()}
}

// createMessageRequest is the payload for posting a chat message.
type createMessageRequest struct {
	Content string `json:"content"`
}

// Messages lists recent chat messages for a group. Group members only.
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

	// Enrich with the sender's display name/avatar so both the REST response and
	// the SSE broadcast carry everything a client needs to render without a
	// follow-up fetch.
	if sender, err := h.repo.GetProfile(r.Context(), userID); err == nil {
		msg.SenderName = sender.FullName
		msg.SenderAvatarURL = sender.AvatarURL
		if sender.Email != "" && msg.SenderName == "" {
			msg.SenderName = sender.Email
		}
	}

	// Fan the new message out to connected subscribers (SSE). Non-blocking.
	h.hub.PublishMessage(*msg)

	writeJSON(w, http.StatusCreated, msg)
}

// Typing broadcasts a transient "is typing" presence ping to the group's
// subscribers. Member only. It is intentionally cheap: no persistence, a tiny
// payload, and the client is expected to throttle it (a few POSTs per second at
// most) rather than firing on every keystroke.
func (h *GroupHandler) Typing(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	if !h.requireGroupMember(w, r, groupID) {
		return
	}
	userID := middleware.UserID(r.Context())

	name := ""
	if p, err := h.repo.GetProfile(r.Context(), userID); err == nil {
		name = p.FullName
		if name == "" {
			name = p.Email
		}
	}

	h.hub.PublishTyping(typingSignal{
		GroupID: groupID,
		UserID:  userID,
		Name:    name,
		At:      time.Now().UnixMilli(),
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Tasks lists all tasks in the group's board. Group members only.
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

// createTaskRequest is the payload for creating a task. Assignees are a list of
// group member ids (may be empty). assigneeId is accepted as a single-value
// fallback for older clients.
type createTaskRequest struct {
	Title        string   `json:"title"`
	Description  string   `json:"description"`
	AssigneeID   *string  `json:"assigneeId"`
	AssigneeIDs  []string `json:"assigneeIds"`
	DueDate      *string  `json:"dueDate"`
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

	// Normalize assignee ids: prefer the list, else fall back to the single id.
	assigneeIDs := req.AssigneeIDs
	if len(assigneeIDs) == 0 && req.AssigneeID != nil && *req.AssigneeID != "" {
		assigneeIDs = []string{*req.AssigneeID}
	}
	if err := h.validateAssignees(w, r, groupID, assigneeIDs); err != nil {
		return
	}

	assignees := make([]models.TaskAssignee, 0, len(assigneeIDs))
	for _, id := range assigneeIDs {
		assignees = append(assignees, models.TaskAssignee{ID: id})
	}

	task, err := h.repo.CreateTask(r.Context(), models.Task{
		GroupID:     groupID,
		Title:       req.Title,
		Description: req.Description,
		Status:      models.TaskStatusTodo,
		DueDate:     due,
		CreatedBy:   &userID,
		Assignees:   assignees,
	})
	if err != nil {
		log.Printf("CreateTask: %v (groupID=%s title=%q assignees=%v)", err, groupID, req.Title, assigneeIDs)
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
// updateTaskAssigneesRequest replaces a task's whole assignee set. An empty
// slice unassigns everyone.
type updateTaskAssigneesRequest struct {
	AssigneeIDs []string `json:"assigneeIds"`
}

// UpdateTaskAssignees replaces a task's assignees with the given member list
// (or clears them). The refreshed task is returned so the card updates live.
func (h *GroupHandler) UpdateTaskAssignees(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	if !h.requireGroupMember(w, r, groupID) {
		return
	}
	taskID := r.PathValue("taskId")
	var req updateTaskAssigneesRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := h.validateAssignees(w, r, groupID, req.AssigneeIDs); err != nil {
		return
	}

	task, err := h.repo.SetTaskAssignees(r.Context(), taskID, groupID, req.AssigneeIDs)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "task not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update task assignees")
		return
	}
	writeJSON(w, http.StatusOK, task)
}

// validateAssignees writes a 400 when any id in the list is not a group member.
// It returns a non-nil error to signal the caller should stop.
func (h *GroupHandler) validateAssignees(w http.ResponseWriter, r *http.Request, groupID string, ids []string) error {
	for _, id := range ids {
		if id == "" {
			continue
		}
		ok, err := h.repo.IsGroupMember(r.Context(), groupID, id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to check assignee")
			return err
		}
		if !ok {
			writeError(w, http.StatusBadRequest, "assignee is not a member of this group")
			return err
		}
	}
	return nil
}

// requireGroupMember enforces that the current user is an actual member of the
// group, writing 403 otherwise. Group workspace content is private to its
// members (course owners/instructors are not granted a view unless they are
// members themselves).
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
