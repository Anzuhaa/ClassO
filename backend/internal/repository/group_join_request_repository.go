package repository

import (
	"context"
	"errors"

	"github.com/classo/backend/internal/models"
	"github.com/jackc/pgx/v5"
)

// Group join-request lifecycle backing the instructor-approval flow: while a
// course is locked, students can't join/switch/leave groups directly; they file
// a request here instead, and the instructor approves (which performs the move)
// or rejects it.

// UpsertJoinRequest records a student's pending request to move into a group
// (groupID may be nil to request leaving the current group instead). The UNIQUE
// (course_id, user_id) constraint means a new request replaces any previous one
// for the same student, so the latest target wins.
func (r *Repo) UpsertJoinRequest(ctx context.Context, courseID, userID string, groupID *string) (*models.GroupJoinRequest, error) {
	row := r.Pool.QueryRow(ctx, `
		INSERT INTO group_join_requests (course_id, group_id, user_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (course_id, user_id) DO UPDATE
			SET group_id = EXCLUDED.group_id,
			    status = 'pending',
			    resolved_at = NULL
		RETURNING id, course_id, group_id, user_id, status, created_at, resolved_at
	`, courseID, groupID, userID)

	var req models.GroupJoinRequest
	if err := row.Scan(&req.ID, &req.CourseID, &req.GroupID, &req.UserID, &req.Status, &req.CreatedAt, &req.ResolvedAt); err != nil {
		return nil, err
	}
	return &req, nil
}

// ListPendingJoinRequests returns all unresolved requests for a course, joined
// with the student's name and target group's name (empty for a leave request)
// for the approval list.
func (r *Repo) ListPendingJoinRequests(ctx context.Context, courseID string) ([]models.GroupJoinRequest, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT r.id, r.course_id, r.group_id, r.user_id, r.status, r.created_at, r.resolved_at,
		       COALESCE(p.full_name, p.email, ''), COALESCE(g.name, '')
		FROM group_join_requests r
		JOIN profiles p ON p.id = r.user_id
		LEFT JOIN groups g ON g.id = r.group_id
		WHERE r.course_id = $1 AND r.status = 'pending'
		ORDER BY r.created_at ASC
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.GroupJoinRequest, 0)
	for rows.Next() {
		var req models.GroupJoinRequest
		if err := rows.Scan(&req.ID, &req.CourseID, &req.GroupID, &req.UserID, &req.Status, &req.CreatedAt, &req.ResolvedAt, &req.UserName, &req.TargetGroupName); err != nil {
			return nil, err
		}
		out = append(out, req)
	}
	return out, rows.Err()
}

// GetJoinRequest loads a single request by id, or ErrNotFound.
func (r *Repo) GetJoinRequest(ctx context.Context, id string) (*models.GroupJoinRequest, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT id, course_id, group_id, user_id, status, created_at, resolved_at
		FROM group_join_requests WHERE id = $1
	`, id)
	var req models.GroupJoinRequest
	if err := row.Scan(&req.ID, &req.CourseID, &req.GroupID, &req.UserID, &req.Status, &req.CreatedAt, &req.ResolvedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &req, nil
}

// ResolveJoinRequest marks a request approved/rejected. When approved it also
// performs the move atomically: remove the user from any current group in the
// course and add them to the target group. It returns ErrNotFound when the
// request does not exist or has already been resolved.
func (r *Repo) ResolveJoinRequest(ctx context.Context, id string, approve bool) (*models.GroupJoinRequest, error) {
	status := "rejected"
	if approve {
		status = "approved"
	}

	var out models.GroupJoinRequest
	err := r.tx(ctx, func(tx pgx.Tx) error {
		req, err := r.GetJoinRequest(ctx, id)
		if err != nil {
			return err
		}
		if req.Status != "pending" {
			return ErrNotFound
		}

		if approve {
			// Move the student: leave their current group in this course (if
			// any). When the request targets a specific group, join it too.
			if _, err := tx.Exec(ctx, `
				DELETE FROM group_members WHERE course_id = $1 AND user_id = $2
			`, req.CourseID, req.UserID); err != nil {
				return err
			}
			if req.GroupID != nil {
				if _, err := tx.Exec(ctx, `
					INSERT INTO group_members (group_id, course_id, user_id, role)
					VALUES ($1, $2, $3, $4)
					ON CONFLICT (group_id, user_id) DO NOTHING
				`, *req.GroupID, req.CourseID, req.UserID, models.RoleMember); err != nil {
					return err
				}
			}
		}

		row := tx.QueryRow(ctx, `
			UPDATE group_join_requests
			SET status = $1, resolved_at = now()
			WHERE id = $2
			RETURNING id, course_id, group_id, user_id, status, created_at, resolved_at
		`, status, id)
		if err := row.Scan(&out.ID, &out.CourseID, &out.GroupID, &out.UserID, &out.Status, &out.CreatedAt, &out.ResolvedAt); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// HasPendingJoinRequest reports whether the student already has an unresolved
// request for the course (so the UI can show "request sent" instead of a fresh
// request button).
func (r *Repo) HasPendingJoinRequest(ctx context.Context, courseID, userID string) (bool, error) {
	var exists bool
	err := r.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM group_join_requests
			WHERE course_id = $1 AND user_id = $2 AND status = 'pending'
		)
	`, courseID, userID).Scan(&exists)
	return exists, err
}

// SetCourseLocked flips the instructor-controlled lock that gates the request
// lifecycle above. It returns the refreshed course so the UI can resync the
// toggle. Instructor-only (owner or courseRole instructor); callers enforce
// that before invoking.
func (r *Repo) SetCourseLocked(ctx context.Context, id string, locked bool) (*models.Course, error) {
	row := r.Pool.QueryRow(ctx, `
		UPDATE courses
		SET locked = $1, updated_at = now()
		WHERE id = $2
		RETURNING `+courseColumns,
		locked, id)

	c, err := scanCourse(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}