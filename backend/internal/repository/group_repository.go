package repository

import (
	"context"
	"errors"

	"github.com/classo/backend/internal/models"
	"github.com/jackc/pgx/v5"
)

// CreateGroupWithMembers inserts a group and its members atomically. The
// first member in memberIDs becomes the group lead; the rest are members.
func (r *Repo) CreateGroupWithMembers(ctx context.Context, g models.Group, memberIDs []string) (*models.Group, error) {
	var created *models.Group
	err := r.tx(ctx, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
			INSERT INTO groups (course_id, name)
			VALUES ($1, $2)
			RETURNING id, course_id, name, created_at
		`, g.CourseID, g.Name)

		var out models.Group
		if err := row.Scan(&out.ID, &out.CourseID, &out.Name, &out.CreatedAt); err != nil {
			return err
		}

		for i, uid := range memberIDs {
			role := models.RoleMember
			if i == 0 {
				role = models.RoleLead
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO group_members (group_id, user_id, role)
				VALUES ($1, $2, $3)
			`, out.ID, uid, role); err != nil {
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

// ListGroups returns all groups in a course with their membership counts,
// ordered by creation time so the dashboard can render a stable list. The
// count lets the frontend disable "Join Group" once a group is full.
func (r *Repo) ListGroups(ctx context.Context, courseID string) ([]models.Group, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT g.id, g.course_id, g.name, g.created_at, COUNT(gm.id)
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
		if err := rows.Scan(&g.ID, &g.CourseID, &g.Name, &g.CreatedAt, &g.MemberCount); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// GetGroup fetches a single group by id.
func (r *Repo) GetGroup(ctx context.Context, id string) (*models.Group, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT id, course_id, name, created_at FROM groups WHERE id = $1
	`, id)

	var g models.Group
	if err := row.Scan(&g.ID, &g.CourseID, &g.Name, &g.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
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
		JOIN groups g ON g.id = gm.group_id
		WHERE g.course_id = $1 AND gm.user_id = $2
		LIMIT 1
	`, courseID, userID).Scan(&groupID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return groupID, err
}

// JoinGroup adds a user to a group as a "member", enforcing (via UNIQUE
// constraint) that a user is not double-added to the same group. Callers must
// check GroupInCourseForUser first to honor the one-group-per-course rule.
func (r *Repo) JoinGroup(ctx context.Context, groupID, userID string) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO group_members (group_id, user_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (group_id, user_id) DO NOTHING
	`, groupID, userID, models.RoleMember)
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

// GetGroupsForUser returns the groups a user belongs to, for the user's
// workspace switcher.
func (r *Repo) GetGroupsForUser(ctx context.Context, userID string) ([]models.Group, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT g.id, g.course_id, g.name, g.created_at
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
		if err := rows.Scan(&g.ID, &g.CourseID, &g.Name, &g.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}
