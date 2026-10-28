package handlers

import (
	"net/http"

	"github.com/classo/backend/internal/middleware"
	"github.com/classo/backend/internal/models"
	"github.com/classo/backend/internal/repository"
	"github.com/classo/backend/internal/services"
)

// CourseHandler serves course, group, and membership endpoints.
type CourseHandler struct {
	repo      *repository.Repo
	formation *services.FormationService
}

// NewCourseHandler wires a CourseHandler with its dependencies.
func NewCourseHandler(repo *repository.Repo, formation *services.FormationService) *CourseHandler {
	return &CourseHandler{repo: repo, formation: formation}
}

// List returns the courses the current user belongs to or owns.
func (h *CourseHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserID(r.Context())
	courses, err := h.repo.ListCourses(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list courses")
		return
	}
	writeJSON(w, http.StatusOK, courses)
}

// createCourseRequest is the payload for creating a course.
type createCourseRequest struct {
	Name      string `json:"name"`
	Code      string `json:"code"`
	GroupSize int    `json:"groupSize"`
}

// Create inserts a new course owned by the current user and enrolls them as
// instructor.
func (h *CourseHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserID(r.Context())
	var req createCourseRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.GroupSize <= 0 {
		writeError(w, http.StatusBadRequest, "groupSize must be positive")
		return
	}

	course, err := h.repo.CreateCourse(r.Context(), models.Course{
		Name:      req.Name,
		Code:      req.Code,
		OwnerID:   userID,
		GroupSize: req.GroupSize,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create course")
		return
	}

	// The owner is also an instructor member.
	if err := h.repo.AddCourseMember(r.Context(), course.ID, userID, models.RoleInstructor); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to enroll instructor")
		return
	}

	writeJSON(w, http.StatusCreated, course)
}

// Form instructs the FormationService to split the course's roster and
// persist groups. Only meaningful for an instructor (owned course).
func (h *CourseHandler) Form(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	course, err := h.repo.GetCourse(r.Context(), courseID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "course not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load course")
		return
	}

	result, err := h.formation.FormGroups(r.Context(), course)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// ListGroups returns all groups in a course.
func (h *CourseHandler) ListGroups(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	groups, err := h.repo.ListGroups(r.Context(), courseID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list groups")
		return
	}
	writeJSON(w, http.StatusOK, groups)
}

// addMemberRequest is the payload for enrolling a user into a course.
type addMemberRequest struct {
	UserID string `json:"userId"`
	Role   string `json:"role"`
}

// AddMember enrolls a user into a course; used for joining by code or invite.
func (h *CourseHandler) AddMember(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
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
