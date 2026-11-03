package repository

import (
	"context"
	"errors"

	"github.com/classo/backend/internal/models"
	"github.com/jackc/pgx/v5"
)

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
// the given course, or "" when not in any group there.
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
// at the DB level; callers should also check capacity before joining.
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