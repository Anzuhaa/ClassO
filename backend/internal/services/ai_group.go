package services

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/classo/backend/internal/models"
)

// groupSplitPrompt is the system instruction asking the model for a balanced
// grouping as a strict JSON response.
const groupSplitPrompt = `You are a group-formation assistant for a university course.
Split the given students into the requested number of groups as evenly as
possible, balancing the distribution of skills across groups so that each
group has a complementary mix (e.g. spread "frontend" and "backend" skills).
Respond with ONLY a JSON object in this exact shape, no prose, no markdown:
{"groups":[{"members":["<student_id>", ...]}, ...]}
Every student id must appear in exactly one group. Each group's "members" is
an array of student ids.`

// inputStudent is the shape of a student sent to the model for grouping.
type inputStudent struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Skills []string `json:"skills"`
}

// groupSplitResult is the parsed model output for group formation.
type groupSplitResult struct {
	Groups []struct {
		Members []string `json:"members"`
	} `json:"groups"`
}

// buildSplitUsersJSON serializes the student roster for the prompt.
func buildSplitUsersJSON(students []models.Profile) string {
	in := make([]inputStudent, 0, len(students))
	for _, s := range students {
		in = append(in, inputStudent{ID: s.ID, Name: s.FullName, Skills: s.Skills})
	}
	b, _ := json.Marshal(in)
	return string(b)
}

// aiSplit asks the model to partition students into numGroups balanced groups
// and returns a validated result: every id used exactly once.
func (c *AIClient) aiSplit(ctx context.Context, students []models.Profile, numGroups int) (*groupSplitResult, error) {
	user := fmt.Sprintf(
		"Students (JSON):\n%s\n\nForm %d groups.",
		buildSplitUsersJSON(students), numGroups,
	)

	raw, err := c.completeJSON(ctx, groupSplitPrompt, user)
	if err != nil {
		return nil, err
	}

	var res groupSplitResult
	if err := json.Unmarshal([]byte(raw), &res); err != nil {
		return nil, fmt.Errorf("decode grouping JSON: %w", err)
	}
	if len(res.Groups) != numGroups {
		return nil, fmt.Errorf("expected %d groups, got %d", numGroups, len(res.Groups))
	}

	// Validate completeness and uniqueness.
	seen := map[string]bool{}
	expected := map[string]bool{}
	for _, s := range students {
		expected[s.ID] = true
	}
	for _, g := range res.Groups {
		for _, id := range g.Members {
			id = strings.TrimSpace(id)
			if !expected[id] {
				return nil, fmt.Errorf("unknown student id %q in grouping", id)
			}
			if seen[id] {
				return nil, fmt.Errorf("student %q appears more than once", id)
			}
			seen[id] = true
		}
	}
	if len(seen) != len(expected) {
		return nil, fmt.Errorf("grouping covers %d of %d students", len(seen), len(expected))
	}

	return &res, nil
}

// deterministicSplit partitions students into numGroups balanced groups using
// a skill-spread round-robin: students are ordered by skill rarity (ascending
// by how many distinct skills they have, then by total skills), then dealt
// round-robin into groups to balance breadth. This is the fallback when the
// AI call fails, so group formation never hard-blocks.
func deterministicSplit(students []models.Profile, numGroups int) [][]string {
	type scored struct {
		id         string
		skillCount int
	}
	scoredList := make([]scored, 0, len(students))
	for _, s := range students {
		scoredList = append(scoredList, scored{id: s.ID, skillCount: len(s.Skills)})
	}
	// Sort ascending by skill count so sparse-skill students spread first,
	// then by id for determinism.
	sort.SliceStable(scoredList, func(i, j int) bool {
		if scoredList[i].skillCount != scoredList[j].skillCount {
			return scoredList[i].skillCount < scoredList[j].skillCount
		}
		return scoredList[i].id < scoredList[j].id
	})

	groups := make([][]string, numGroups)
	for i, s := range scoredList {
		idx := i % numGroups
		groups[idx] = append(groups[idx], s.id)
	}
	return groups
}

// SplitMembers returns the model's balanced grouping when available, falling
// back to the deterministic round-robin split on any AI error or invalid
// response. It returns the grouping plus a bool indicating whether the result
// came from the AI (true) or the fallback (false).
func (c *AIClient) SplitMembers(ctx context.Context, students []models.Profile, numGroups int) (groups [][]string, usedAI bool, err error) {
	if numGroups <= 0 {
		return nil, false, fmt.Errorf("numGroups must be positive")
	}
	if len(students) == 0 {
		return nil, false, fmt.Errorf("no students to group")
	}

	res, err := c.aiSplit(ctx, students, numGroups)
	if err != nil {
		return deterministicSplit(students, numGroups), false, nil
	}
	groups = make([][]string, 0, len(res.Groups))
	for _, g := range res.Groups {
		groups = append(groups, g.Members)
	}
	return groups, true, nil
}
