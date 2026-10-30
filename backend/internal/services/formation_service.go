// Package services contains the group-formation logic. Formation is
// deterministic: it shuffles the enrolled roster and deals members round-robin
// into evenly-sized groups, honoring per-group capacity and the one-group-per-
// course rule.
package services

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"github.com/classo/backend/internal/models"
	"github.com/classo/backend/internal/repository"
)

// FormationService orchestrates course-wide group formation: it gathers the
// roster, shuffles deterministically, and persists groups plus members
// atomically.
type FormationService struct {
	repo *repository.Repo
}

// NewFormationService wires a FormationService with its dependencies.
func NewFormationService(repo *repository.Repo) *FormationService {
	return &FormationService{repo: repo}
}

// FormationResult reports the outcome of a group-formation run.
type FormationResult struct {
	CourseID string         `json:"courseId"`
	Groups   []models.Group `json:"groups"`
}

// RandomAssign splits only the enrolled students (never instructors) into
// evenly-sized groups using a Fisher-Yates shuffle, resetting any existing
// distribution first, and persists the result. Returns the created groups.
func (s *FormationService) RandomAssign(ctx context.Context, course *models.Course, capacity int) (*FormationResult, error) {
	if capacity <= 0 {
		return nil, fmt.Errorf("capacity must be positive")
	}

	students, err := s.repo.ListStudentsByCourse(ctx, course.ID)
	if err != nil {
		return nil, fmt.Errorf("list students: %w", err)
	}
	if len(students) == 0 {
		return nil, fmt.Errorf("no students enrolled in this course to group")
	}

	// Clear any prior distribution so re-running "random assign" is safe and the
	// one-group-per-course unique constraint cannot be tripped by a stale row.
	if err := s.repo.ResetCourseGroups(ctx, course.ID); err != nil {
		return nil, fmt.Errorf("reset existing groups: %w", err)
	}

	ids := make([]string, 0, len(students))
	for _, s := range students {
		ids = append(ids, s.ID)
	}

	// Fisher-Yates shuffle with a time-based seed for a fresh random split.
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	rng.Shuffle(len(ids), func(i, j int) { ids[i], ids[j] = ids[j], ids[i] })

	// Group count must fit everyone within capacity.
	numGroups := (len(ids) + capacity - 1) / capacity
	if numGroups < 1 {
		numGroups = 1
	}

	// Deal round-robin so groups are as even as possible and each student
	// lands in exactly one group.
	grouping := make([][]string, numGroups)
	for i, id := range ids {
		grouping[i%numGroups] = append(grouping[i%numGroups], id)
	}

	result := &FormationResult{CourseID: course.ID, Groups: []models.Group{}}
	for i, memberIDs := range grouping {
		g := models.Group{
			CourseID: course.ID,
			Name:     fmt.Sprintf("Group %d", i+1),
			Capacity: capacity,
		}
		created, err := s.repo.CreateGroupWithMembers(ctx, g, memberIDs)
		if err != nil {
			return nil, fmt.Errorf("create group %d: %w", i+1, err)
		}
		result.Groups = append(result.Groups, *created)
	}

	return result, nil
}
