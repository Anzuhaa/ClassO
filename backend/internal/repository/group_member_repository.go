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

// GetGroupMemberRole returns the group role ("lead" or "member") for a user in
// a group, or "" when they do not belong to it.
func (r *Repo) GetGroupMemberRole(ctx context.Context, groupID, userID string) (string, error) {
	var role string
	err := r.Pool.QueryRow(ctx, `
		SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2
	`, groupID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return role, err
}

// SetGroupLead promotes the named member to "lead" and demotes any existing
// lead, atomically, so there is always at most one lead per group. It returns
// ErrNotFound when the target is not a member of the group.
func (r *Repo) SetGroupLead(ctx context.Context, groupID, userID string) error {
	return r.tx(ctx, func(tx pgx.Tx) error {
		demote, err := tx.Exec(ctx, `
			UPDATE group_members SET role = $2 WHERE group_id = $1 AND role = $3
		`, groupID, models.RoleMember, models.RoleLead)
		if err != nil {
			return err
		}
		promote, err := tx.Exec(ctx, `
			UPDATE group_members SET role = $2 WHERE group_id = $1 AND user_id = $3
		`, groupID, models.RoleLead, userID)
		if err != nil {
			return err
		}
		_ = demote
		if promote.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// IsGroupMember reports whether the user belongs to the group as an actual
// member. A group's private workspace content (chat, tasks, files) is visible
// only to its members — course owners and instructors get no view here unless
// they are themselves members, so a group with zero members and one with many
// are both "locked" to everyone outside it. Instructor management actions
// (create/delete/rename/remove member) are gated separately by
// IsCourseInstructor and are unaffected.
func (r *Repo) IsGroupMember(ctx context.Context, groupID, userID string) (bool, error) {
	var exists bool
	err := r.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM group_members gm
			WHERE gm.group_id = $1 AND gm.user_id = $2
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