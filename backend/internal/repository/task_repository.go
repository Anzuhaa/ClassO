package repository

import (
	"context"
	"errors"

	"github.com/classo/backend/internal/models"
	"github.com/jackc/pgx/v5"
)

// assigneeColumns is the SELECT list shared by the task queries that also load
// the (now multi-valued) assignee list via a scalar subquery, so the board can
// render every assignee without a second round-trip. It is qualified with the
// `t` alias and therefore only valid where `t` is in scope (SELECT ... FROM
// tasks t, or UPDATE tasks t ... RETURNING).
const taskWithAssignees = `
	t.id, t.group_id, t.title, COALESCE(t.description, ''), t.assignee_id,
	t.status, t.due_date, t.created_by, t.created_at, t.updated_at,
	(SELECT COALESCE((SELECT p.full_name FROM profiles p WHERE p.id = t.assignee_id), ''))`

// taskWithAssigneesBare is the same column list for an INSERT ... RETURNING,
// where there is no table alias, so columns are referenced bare and the
// assignee-name subquery correlates on the unqualified assignee_id.
const taskWithAssigneesBare = `
	id, group_id, title, COALESCE(description, ''), assignee_id,
	status, due_date, created_by, created_at, updated_at,
	(SELECT COALESCE((SELECT p.full_name FROM profiles p WHERE p.id = tasks.assignee_id), ''))`

// scanTask scans a single row (with the scalar assignee-name column) into a
// models.Task, then loads the full assignee list from task_assignees.
func (r *Repo) scanTask(ctx context.Context, row pgx.Row) (*models.Task, error) {
	var t models.Task
	if err := row.Scan(&t.ID, &t.GroupID, &t.Title, &t.Description, &t.AssigneeID,
		&t.Status, &t.DueDate, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt, &t.AssigneeName); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	assignees, err := r.ListTaskAssignees(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	t.Assignees = assignees
	return &t, nil
}

// ListTaskAssignees returns every assignee on a task, joined to their name.
func (r *Repo) ListTaskAssignees(ctx context.Context, taskID string) ([]models.TaskAssignee, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT p.id, COALESCE(p.full_name, '')
		FROM task_assignees ta
		JOIN profiles p ON p.id = ta.user_id
		WHERE ta.task_id = $1
		ORDER BY p.full_name
	`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.TaskAssignee, 0)
	for rows.Next() {
		var a models.TaskAssignee
		if err := rows.Scan(&a.ID, &a.FullName); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// CreateTask inserts a task and its assignees atomically, returning the task
// with its generated id, timestamps, and assignee list.
func (r *Repo) CreateTask(ctx context.Context, t models.Task) (*models.Task, error) {
	var created *models.Task
	err := r.tx(ctx, func(tx pgx.Tx) error {
		// The first assignee is mirrored into tasks.assignee_id for backward
		// compatibility; the authoritative list lives in task_assignees.
		var first *string
		if len(t.Assignees) > 0 {
			id := t.Assignees[0].ID
			first = &id
		}

		row := tx.QueryRow(ctx, `
			INSERT INTO tasks (group_id, title, description, assignee_id, status, due_date, created_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING `+taskWithAssigneesBare,
			t.GroupID, t.Title, nullIfEmpty(t.Description), first, t.Status, t.DueDate, t.CreatedBy)

		var out models.Task
		if err := row.Scan(&out.ID, &out.GroupID, &out.Title, &out.Description, &out.AssigneeID,
			&out.Status, &out.DueDate, &out.CreatedBy, &out.CreatedAt, &out.UpdatedAt, &out.AssigneeName); err != nil {
			return err
		}

		for _, a := range t.Assignees {
			if _, err := tx.Exec(ctx, `
				INSERT INTO task_assignees (task_id, user_id)
				VALUES ($1, $2)
				ON CONFLICT (task_id, user_id) DO NOTHING
			`, out.ID, a.ID); err != nil {
				return err
			}
		}

		out.Assignees = t.Assignees
		created = &out
		return nil
	})
	if err != nil {
		return nil, err
	}
	return created, nil
}

// ListTasks returns all tasks in a group with their assignee lists, ordered by
// creation for stable kanban rendering.
func (r *Repo) ListTasks(ctx context.Context, groupID string) ([]models.Task, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT `+taskWithAssignees+`
		FROM tasks t
		WHERE t.group_id = $1
		ORDER BY t.created_at ASC
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.Task, 0)
	for rows.Next() {
		var t models.Task
		if err := rows.Scan(&t.ID, &t.GroupID, &t.Title, &t.Description, &t.AssigneeID,
			&t.Status, &t.DueDate, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt, &t.AssigneeName); err != nil {
			return nil, err
		}
		assignees, err := r.ListTaskAssignees(ctx, t.ID)
		if err != nil {
			return nil, err
		}
		t.Assignees = assignees
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

// SetTaskAssignees atomically replaces a task's assignees with the given list
// (which may be empty to unassign everyone) and returns the refreshed task.
func (r *Repo) SetTaskAssignees(ctx context.Context, id, groupID string, assigneeIDs []string) (*models.Task, error) {
	var out *models.Task
	err := r.tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM task_assignees WHERE task_id = $1`, id); err != nil {
			return err
		}
		var first *string
		if len(assigneeIDs) > 0 {
			for _, uid := range assigneeIDs {
				if _, err := tx.Exec(ctx, `
					INSERT INTO task_assignees (task_id, user_id)
					VALUES ($1, $2)
				`, id, uid); err != nil {
					return err
				}
			}
			f := assigneeIDs[0]
			first = &f
		}

		row := tx.QueryRow(ctx, `
			UPDATE tasks t
			SET assignee_id = $1, updated_at = now()
			WHERE t.id = $2 AND t.group_id = $3
			RETURNING `+taskWithAssignees,
			first, id, groupID)

		var t models.Task
		if err := row.Scan(&t.ID, &t.GroupID, &t.Title, &t.Description, &t.AssigneeID,
			&t.Status, &t.DueDate, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt, &t.AssigneeName); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		assignees, err := r.ListTaskAssignees(ctx, id)
		if err != nil {
			return err
		}
		t.Assignees = assignees
		out = &t
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
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