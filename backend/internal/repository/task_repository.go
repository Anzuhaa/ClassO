package repository

import (
	"context"

	"github.com/classo/backend/internal/models"
)

// CreateTask inserts a task and returns it with generated id/timestamps.
func (r *Repo) CreateTask(ctx context.Context, t models.Task) (*models.Task, error) {
	row := r.Pool.QueryRow(ctx, `
		INSERT INTO tasks (group_id, title, description, assignee_id, status, due_date, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, group_id, title, COALESCE(description, ''), assignee_id,
		          status, due_date, created_by, created_at, updated_at
	`, t.GroupID, t.Title, nullIfEmpty(t.Description), t.AssigneeID, t.Status, t.DueDate, t.CreatedBy)

	var out models.Task
	err := row.Scan(&out.ID, &out.GroupID, &out.Title, &out.Description, &out.AssigneeID,
		&out.Status, &out.DueDate, &out.CreatedBy, &out.CreatedAt, &out.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ListTasks returns all tasks in a group joined to the assignee name,
// ordered by creation for stable kanban rendering.
func (r *Repo) ListTasks(ctx context.Context, groupID string) ([]models.Task, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT t.id, t.group_id, t.title, COALESCE(t.description, ''), t.assignee_id,
		       t.status, t.due_date, t.created_by, t.created_at, t.updated_at,
		       COALESCE(p.full_name, '')
		FROM tasks t
		LEFT JOIN profiles p ON p.id = t.assignee_id
		WHERE t.group_id = $1
		ORDER BY t.created_at ASC
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Task
	for rows.Next() {
		var t models.Task
		if err := rows.Scan(&t.ID, &t.GroupID, &t.Title, &t.Description, &t.AssigneeID,
			&t.Status, &t.DueDate, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt, &t.AssigneeName); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// UpdateTaskStatus updates only the status field and bumps updated_at.
func (r *Repo) UpdateTaskStatus(ctx context.Context, id, groupID, status string) error {
	cmd, err := r.Pool.Exec(ctx, `
		UPDATE tasks SET status = $1, updated_at = now()
		WHERE id = $2 AND group_id = $3
	`, status, id, groupID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateTaskAssignee reassigns a task to a new member (or nil).
func (r *Repo) UpdateTaskAssignee(ctx context.Context, id, groupID string, assigneeID *string) error {
	cmd, err := r.Pool.Exec(ctx, `
		UPDATE tasks SET assignee_id = $1, updated_at = now()
		WHERE id = $2 AND group_id = $3
	`, assigneeID, id, groupID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteTask removes a task from a group.
func (r *Repo) DeleteTask(ctx context.Context, id, groupID string) error {
	cmd, err := r.Pool.Exec(ctx, `
		DELETE FROM tasks WHERE id = $1 AND group_id = $2
	`, id, groupID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// nullIfEmpty returns nil for an empty string so empty descriptions store as
// NULL rather than ”, keeping the schema clean.
func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
