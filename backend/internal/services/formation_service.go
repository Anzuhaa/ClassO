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
// roster, calls the AI balancer (with deterministic fallback), and persists
// groups plus their members in the database.
type FormationService struct {
	repo *repository.Repo
	ai   *AIClient
}

// NewFormationService wires a FormationService with its dependencies.
func NewFormationService(repo *repository.Repo, ai *AIClient) *FormationService {
	return &FormationService{repo: repo, ai: ai}
}

// FormationResult reports the outcome of a group-formation run.
type FormationResult struct {
	CourseID string         `json:"courseId"`
	Groups   []models.Group `json:"groups"`
	UsedAI   bool           `json:"usedAi"`
}

// FormGroups splits all students enrolled in the course into groups of the
// course's configured group_size and persists them. It returns the created
// groups and whether the AI (vs. deterministic fallback) produced the split.
func (s *FormationService) FormGroups(ctx context.Context, course *models.Course) (*FormationResult, error) {
	students, err := s.repo.ListProfilesByCourse(ctx, course.ID)
	if err != nil {
		return nil, fmt.Errorf("list students: %w", err)
	}
	if len(students) == 0 {
		return nil, fmt.Errorf("no students enrolled in this course to group")
	}

	// Compute group count from group_size, rounding up to include everyone.
	numGroups := (len(students) + course.GroupSize - 1) / course.GroupSize
	if numGroups < 1 {
		numGroups = 1
	}

	grouping, usedAI, err := s.ai.SplitMembers(ctx, students, numGroups)
	if err != nil {
		return nil, fmt.Errorf("split members: %w", err)
	}

	result := &FormationResult{CourseID: course.ID, UsedAI: usedAI, Groups: []models.Group{}}
	for i, memberIDs := range grouping {
		g := models.Group{
			CourseID: course.ID,
			Name:     fmt.Sprintf("Group %d", i+1),
		}
		created, err := s.repo.CreateGroupWithMembers(ctx, g, memberIDs)
		if err != nil {
			return nil, fmt.Errorf("create group %d: %w", i+1, err)
		}
		result.Groups = append(result.Groups, *created)
	}

	return result, nil
}

// RandomAssign splits all enrolled students into evenly-sized groups using a
// fast Fisher-Yates shuffle (no AI call), then persists them exactly like
// FormGroups. It returns the same FormationResult shape with UsedAI=false.
func (s *FormationService) RandomAssign(ctx context.Context, course *models.Course) (*FormationResult, error) {
	students, err := s.repo.ListProfilesByCourse(ctx, course.ID)
	if err != nil {
		return nil, fmt.Errorf("list students: %w", err)
	}
	if len(students) == 0 {
		return nil, fmt.Errorf("no students enrolled in this course to group")
	}

	numGroups := (len(students) + course.GroupSize - 1) / course.GroupSize
	if numGroups < 1 {
		numGroups = 1
	}

	ids := make([]string, 0, len(students))
	for _, s := range students {
		ids = append(ids, s.ID)
	}

	// Fisher-Yates shuffle with a time-based seed for a fresh random split.
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	rng.Shuffle(len(ids), func(i, j int) { ids[i], ids[j] = ids[j], ids[i] })

	// Deal round-robin so groups are as even as possible.
	grouping := make([][]string, numGroups)
	for i, id := range ids {
		grouping[i%numGroups] = append(grouping[i%numGroups], id)
	}

	result := &FormationResult{CourseID: course.ID, UsedAI: false, Groups: []models.Group{}}
	for i, memberIDs := range grouping {
		g := models.Group{
			CourseID: course.ID,
			Name:     fmt.Sprintf("Group %d", i+1),
		}
		created, err := s.repo.CreateGroupWithMembers(ctx, g, memberIDs)
		if err != nil {
			return nil, fmt.Errorf("create group %d: %w", i+1, err)
		}
		result.Groups = append(result.Groups, *created)
	}

	return result, nil
}
