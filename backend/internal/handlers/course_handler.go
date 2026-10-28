package handlers

import (
	"net/http"
	"strings"

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

// Get returns a single course by id, including its join code so instructors can
// share it from the course header.
func (h *CourseHandler) Get(w http.ResponseWriter, r *http.Request) {
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
	writeJSON(w, http.StatusOK, course)
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

// joinCourseRequest is the payload for joining a course by its join code.
type joinCourseRequest struct {
	JoinCode string `json:"joinCode"`
}

// JoinByCode enrolls the current user into the course matching the given join
// code as a student. Idempotent: joining an already-joined course is a no-op
// success.
func (h *CourseHandler) JoinByCode(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserID(r.Context())
	var req joinCourseRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	code := strings.TrimSpace(req.JoinCode)
	if code == "" {
		writeError(w, http.StatusBadRequest, "joinCode is required")
		return
	}

	course, err := h.repo.GetCourseByJoinCode(r.Context(), code)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "invalid join code")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to look up course")
		return
	}

	if err := h.repo.AddCourseMember(r.Context(), course.ID, userID, models.RoleStudent); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to join course")
		return
	}
	writeJSON(w, http.StatusOK, course)
}

// Members returns the enrollment roster (profiles + per-course role) for a
// course, so instructors and students can see who is enrolled and their tags.
func (h *CourseHandler) Members(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	members, err := h.repo.ListCourseMembers(r.Context(), courseID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list members")
		return
	}
	writeJSON(w, http.StatusOK, members)
}

// MyGroup returns the group id the current user already belongs to within this
// course (or an empty string when they are in none). The frontend uses this to
// render the "Joined" state and disable join buttons across groups.
func (h *CourseHandler) MyGroup(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	userID := middleware.UserID(r.Context())
	groupID, err := h.repo.GroupInCourseForUser(r.Context(), courseID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load membership")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"groupId": groupID})
}

// RandomAssign splits the course roster into groups using a fast deterministic
// shuffle, bypassing the AI. It is the instructor's "Random Assign" action.
func (h *CourseHandler) RandomAssign(w http.ResponseWriter, r *http.Request) {
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

	result, err := h.formation.RandomAssign(r.Context(), course)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}
