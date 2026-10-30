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
// them in insertion order. Used to create several empty groups at once. Names
// are suffixed ("Group 1", "Group 2", …) when more than one is requested.
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
// tripping the one-group-per-course unique constraint. Deleting the groups also
// cascades to their messages, tasks, and files via FK ON DELETE CASCADE.
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

// ListGroups returns all groups in a course with their membership counts,
// ordered by creation time so the dashboard renders a stable list.
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
	return out, rows.Err()
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

// ListGroupMemberIDs returns every user id in a group.
func (r *Repo) ListGroupMemberIDs(ctx context.Context, groupID string) ([]string, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT user_id FROM group_members WHERE group_id = $1 ORDER BY user_id
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]string, 0)
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			return nil, err
		}
		out = append(out, uid)
	}
	return out, rows.Err()
}

// CountGroupMembers returns the number of members in a group (current size).
func (r *Repo) CountGroupMembers(ctx context.Context, groupID string) (int, error) {
	var n int
	err := r.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM group_members WHERE group_id = $1
	`, groupID).Scan(&n)
	return n, err
}

// GroupInCourseForUser returns the group id the user already belongs to within
// the given course, or "" when the user is not yet in any group there.
func (r *Repo) GroupInCourseForUser(ctx context.Context, courseID, userID string) (string, error) {
	var groupID string
	err := r.Pool.QueryRow(ctx, `
		SELECT gm.group_id
		FROM group_members gm
		WHERE gm.course_id = $1 AND gm.user_id = $2
		LIMIT 1
	`, courseID, userID).Scan(&groupID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return groupID, err
}

// JoinGroup adds a user to a group as a "member". The UNIQUE (course_id,
// user_id) constraint on group_members enforces the one-group-per-course rule
// at the database level; this returns the raw conflict so callers can surface a
// friendly message. Callers should also check capacity before joining.
func (r *Repo) JoinGroup(ctx context.Context, groupID, courseID, userID string) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO group_members (group_id, course_id, user_id, role)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (group_id, user_id) DO NOTHING
	`, groupID, courseID, userID, models.RoleMember)
	return err
}

// IsGroupMember reports whether the user belongs to the group, or owns the
// course that contains the group (so instructors can also view group content).
func (r *Repo) IsGroupMember(ctx context.Context, groupID, userID string) (bool, error) {
	var exists bool
	err := r.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM group_members gm
			JOIN groups g ON g.id = gm.group_id
			JOIN courses c ON c.id = g.course_id
			WHERE gm.group_id = $1 AND (gm.user_id = $2 OR c.owner_id = $2)
		)
	`, groupID, userID).Scan(&exists)
	return exists, err
}

// RemoveGroupMember removes a user from a group (instructor or self-leave).
// Returns ErrNotFound when the membership did not exist.
func (r *Repo) RemoveGroupMember(ctx context.Context, groupID, userID string) error {
	cmd, err := r.Pool.Exec(ctx, `
		DELETE FROM group_members WHERE group_id = $1 AND user_id = $2
	`, groupID, userID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteGroup removes a group (and its messages/files/tasks via FK cascade).
// Returns ErrNotFound when the group does not exist.
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

// GetGroupsForUser returns the groups a user belongs to, for the workspace
// switcher.
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
