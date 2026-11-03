package repository

import (
	"context"
	"errors"

	"github.com/classo/backend/internal/models"
	"github.com/jackc/pgx/v5"
)

// CreateGroup inserts a single (possibly empty) group with a capacity. Used for
// manual group setup by instructors.
func (r *Repo) CreateGroup(ctx context.Context, g models.Group) (*models.Group, error) {
	row := r.Pool.QueryRow(ctx, `
		INSERT INTO groups (course_id, name, capacity)
		VALUES ($1, $2, $3)
		RETURNING id, course_id, name, capacity, created_at
	`, g.CourseID, g.Name, g.Capacity)

	var out models.Group
	if err := row.Scan(&out.ID, &out.CourseID, &out.Name, &out.Capacity, &out.CreatedAt); err != nil {
		return nil, err
	}
	return &out, nil
}

// CreateGroups inserts multiple groups, all with the same capacity, returning
// them in insertion order. Names are suffixed ("Group 1", "Group 2", …) when
// more than one is requested.
func (r *Repo) CreateGroups(ctx context.Context, courseID, baseName string, capacity, count int) ([]models.Group, error) {
	groups := make([]models.Group, 0, count)
	for i := 0; i < count; i++ {
		name := baseName
		if count > 1 {
			name = baseName + " " + itoa(i+1)
		}
		g, err := r.CreateGroup(ctx, models.Group{CourseID: courseID, Name: name, Capacity: capacity})
		if err != nil {
			return nil, err
		}
		groups = append(groups, *g)
	}
	return groups, nil
}

// CreateGroupWithMembers inserts a group, its members, and (atomically) the
// members' course_id denormalization so the one-group-per-course unique
// constraint holds. The first member in memberIDs becomes the group lead.
func (r *Repo) CreateGroupWithMembers(ctx context.Context, g models.Group, memberIDs []string) (*models.Group, error) {
	var created *models.Group
	err := r.tx(ctx, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
			INSERT INTO groups (course_id, name, capacity)
			VALUES ($1, $2, $3)
			RETURNING id, course_id, name, capacity, created_at
		`, g.CourseID, g.Name, g.Capacity)

		var out models.Group
		if err := row.Scan(&out.ID, &out.CourseID, &out.Name, &out.Capacity, &out.CreatedAt); err != nil {
			return err
		}

		for i, uid := range memberIDs {
			role := models.RoleMember
			if i == 0 {
				role = models.RoleLead
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO group_members (group_id, course_id, user_id, role)
				VALUES ($1, $2, $3, $4)
			`, out.ID, g.CourseID, uid, role); err != nil {
				return err
			}
		}

		created = &out
		return nil
	})
	if err != nil {
		return nil, err
	}
	return created, nil
}

// ResetCourseGroups atomically removes every group membership and group within
// a course so a fresh random assignment can redistribute the roster without
// tripping the one-group-per-course unique constraint.
func (r *Repo) ResetCourseGroups(ctx context.Context, courseID string) error {
	return r.tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			DELETE FROM group_members WHERE course_id = $1
		`, courseID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			DELETE FROM groups WHERE course_id = $1
		`, courseID); err != nil {
			return err
		}
		return nil
	})
}

// ListGroups returns all groups in a course with their membership counts and
// member rosters, ordered by creation time so the dashboard renders a stable
// list. The roster is joined in so students can see who is in every team.
func (r *Repo) ListGroups(ctx context.Context, courseID string) ([]models.Group, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT g.id, g.course_id, g.name, g.capacity, g.created_at, COUNT(gm.id)
		FROM groups g
		LEFT JOIN group_members gm ON gm.group_id = g.id
		WHERE g.course_id = $1
		GROUP BY g.id
		ORDER BY g.created_at ASC
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.Group, 0)
	for rows.Next() {
		var g models.Group
		if err := rows.Scan(&g.ID, &g.CourseID, &g.Name, &g.Capacity, &g.CreatedAt, &g.MemberCount); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Attach each group's member roster (names/usernames/avatars).
	for i := range out {
		members, err := r.ListProfilesByGroup(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Members = members
	}
	return out, nil
}

// GetGroup fetches a single group by id.
func (r *Repo) GetGroup(ctx context.Context, id string) (*models.Group, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT id, course_id, name, capacity, created_at FROM groups WHERE id = $1
	`, id)

	var g models.Group
	if err := row.Scan(&g.ID, &g.CourseID, &g.Name, &g.Capacity, &g.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &g, nil
}

// RenameGroup updates a group's name and returns the refreshed group.
func (r *Repo) RenameGroup(ctx context.Context, id, name string) (*models.Group, error) {
	row := r.Pool.QueryRow(ctx, `
		UPDATE groups SET name = $1, updated_at = now()
		WHERE id = $2
		RETURNING id, course_id, name, capacity, created_at
	`, name, id)
	var g models.Group
	if err := row.Scan(&g.ID, &g.CourseID, &g.Name, &g.Capacity, &g.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &g, nil
}

// DeleteGroup removes a group (and its messages/files/tasks via FK cascade).
func (r *Repo) DeleteGroup(ctx context.Context, groupID string) error {
	cmd, err := r.Pool.Exec(ctx, `DELETE FROM groups WHERE id = $1`, groupID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) GetGroupsForUser(ctx context.Context, userID string) ([]models.Group, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT g.id, g.course_id, g.name, g.capacity, g.created_at
		FROM groups g
		JOIN group_members gm ON gm.group_id = g.id
		WHERE gm.user_id = $1
		ORDER BY g.created_at ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.Group, 0)
	for rows.Next() {
		var g models.Group
		if err := rows.Scan(&g.ID, &g.CourseID, &g.Name, &g.Capacity, &g.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// itoa formats a small non-negative integer without importing strconv.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var digits [20]byte
	i := len(digits)
	for n > 0 {
		i--
		digits[i] = byte('0' + n%10)
		n /= 10
	}
	return string(digits[i:])
}