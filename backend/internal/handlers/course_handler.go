package handlers

import (
	"log"
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
// share it from the course header. Only the owner or an enrolled member may read
// it (403 otherwise).
func (h *CourseHandler) Get(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	userID := middleware.UserID(r.Context())
	course, err := h.repo.GetCourse(r.Context(), courseID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "course not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load course")
		return
	}

	member, err := h.repo.IsCourseMember(r.Context(), courseID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check access")
		return
	}
	if !member {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	writeJSON(w, http.StatusOK, course)
}

// createCourseRequest is the payload for creating a course.
type createCourseRequest struct {
	Name string `json:"name"`
	Code string `json:"code"`
}

// Create inserts a new course owned by the current user and enrolls them as
// instructor.
func (h *CourseHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserID(r.Context())
	var req createCourseRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	// Only instructors may create courses.
	profile, err := h.repo.GetProfile(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load profile")
		return
	}
	if profile.Role != models.RoleInstructor {
		writeError(w, http.StatusForbidden, "only instructors can create courses")
		return
	}

	course, err := h.repo.CreateCourse(r.Context(), models.Course{
		Name:    strings.TrimSpace(req.Name),
		Code:    strings.TrimSpace(req.Code),
		OwnerID: userID,
	})
	if err != nil {
		log.Printf("create course: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to create course")
		return
	}

	// The owner is also an instructor member.
	if err := h.repo.AddCourseMember(r.Context(), course.ID, userID, models.RoleInstructor); err != nil {
		log.Printf("enroll instructor: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to enroll instructor")
		return
	}

	writeJSON(w, http.StatusCreated, course)
}

// Delete removes a course owned by the current user, cascading to all groups,
// members, and workspace content (messages/files/tasks).
func (h *CourseHandler) Delete(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	userID := middleware.UserID(r.Context())
	if err := h.repo.DeleteCourse(r.Context(), courseID, userID); err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusForbidden, "forbidden")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete course")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// RegenerateJoinCode issues a fresh join code for an owned course.
func (h *CourseHandler) RegenerateJoinCode(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	if !h.requireInstructor(w, r, courseID) {
		return
	}
	userID := middleware.UserID(r.Context())
	course, err := h.repo.RegenerateJoinCode(r.Context(), courseID, userID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "course not found or not owned")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to regenerate join code")
		return
	}
	writeJSON(w, http.StatusOK, course)
}

// ExpireJoinCode revokes a course's join code so new joins are rejected.
func (h *CourseHandler) ExpireJoinCode(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	if !h.requireInstructor(w, r, courseID) {
		return
	}
	userID := middleware.UserID(r.Context())
	course, err := h.repo.ExpireJoinCode(r.Context(), courseID, userID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "course not found or not owned")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to expire join code")
		return
	}
	writeJSON(w, http.StatusOK, course)
}

// ListGroups returns all groups in a course.
func (h *CourseHandler) ListGroups(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	if !h.requireMember(w, r, courseID) {
		return
	}
	groups, err := h.repo.ListGroups(r.Context(), courseID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list groups")
		return
	}
	writeJSON(w, http.StatusOK, groups)
}

// joinCourseRequest is the payload for joining a course by its join code.
type joinCourseRequest struct {
	JoinCode string `json:"joinCode"`
}

// JoinByCode enrolls the current user into the course matching the given join
// code as a student. Idempotent: joining an already-joined course is a no-op.
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
			writeError(w, http.StatusNotFound, "invalid or expired join code")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to look up course")
		return
	}

	// Enroll with the user's global profile role (instructor accounts join as
	// instructors; students as students), not always as student.
	role := models.RoleStudent
	if profile, err := h.repo.GetProfile(r.Context(), userID); err == nil && profile.Role == models.RoleInstructor {
		role = models.RoleInstructor
	}

	if err := h.repo.AddCourseMember(r.Context(), course.ID, userID, role); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to join course")
		return
	}
	writeJSON(w, http.StatusOK, course)
}

// randomAssignRequest carries the target group capacity for random assignment.
type randomAssignRequest struct {
	Capacity int `json:"capacity"`
}

// RandomAssign splits the course roster into groups using a deterministic
// shuffle, respecting the given (or default) capacity and the one-group-per-
// course rule. It is the instructor's "Random Assign" action.
func (h *CourseHandler) RandomAssign(w http.ResponseWriter, r *http.Request) {
	courseID := r.PathValue("id")
	if !h.requireInstructor(w, r, courseID) {
		return
	}
	course, err := h.repo.GetCourse(r.Context(), courseID)
	if err != nil {
		if err == repository.ErrNotFound {
			writeError(w, http.StatusNotFound, "course not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load course")
		return
	}

	var req randomAssignRequest
	_ = decodeJSON(w, r, &req) // body is optional; capacity defaults below
	capacity := req.Capacity
	if capacity <= 0 {
		capacity = 4
	}

	result, err := h.formation.RandomAssign(r.Context(), course, capacity)
	if err != nil {
		// Sanitize: never leak raw internal errors. Map the two known benign
		// cases to a clear message, everything else to a generic 500.
		if strings.Contains(err.Error(), "no students") {
			writeError(w, http.StatusUnprocessableEntity, "no students enrolled in this course to group")
			return
		}
		if repository.IsUniqueViolation(err) {
			writeError(w, http.StatusConflict, "group assignment conflicted with an existing membership; please retry")
			return
		}
		log.Printf("random assign: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to randomly assign groups")
		return
	}
	writeJSON(w, http.StatusOK, result)
}
