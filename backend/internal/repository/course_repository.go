package repository

import (
	"context"
	"errors"

	"github.com/classo/backend/internal/models"
	"github.com/jackc/pgx/v5"
)

// ErrNotFound is returned when a queried row does not exist.
var ErrNotFound = errors.New("record not found")

// CreateCourse inserts a course and returns it with generated id/timestamps.
func (r *Repo) CreateCourse(ctx context.Context, c models.Course) (*models.Course, error) {
	row := r.Pool.QueryRow(ctx, `
		INSERT INTO courses (name, code, owner_id, group_size)
		VALUES ($1, $2, $3, $4)
		RETURNING id, name, code, owner_id, group_size, created_at, updated_at
	`, c.Name, c.Code, c.OwnerID, c.GroupSize)

	var out models.Course
	err := row.Scan(&out.ID, &out.Name, &out.Code, &out.OwnerID, &out.GroupSize, &out.CreatedAt, &out.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// GetCourse fetches a course by id.
func (r *Repo) GetCourse(ctx context.Context, id string) (*models.Course, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT id, name, COALESCE(code, ''), owner_id, group_size, created_at, updated_at
		FROM courses WHERE id = $1
	`, id)

	var c models.Course
	err := row.Scan(&c.ID, &c.Name, &c.Code, &c.OwnerID, &c.GroupSize, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// ListCourses returns every course the given user is a member of (owned or
// enrolled), used to populate the home dashboard.
func (r *Repo) ListCourses(ctx context.Context, userID string) ([]models.Course, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT DISTINCT c.id, c.name, COALESCE(c.code, ''), c.owner_id, c.group_size, c.created_at, c.updated_at
		FROM courses c
		LEFT JOIN course_members cm ON cm.course_id = c.id
		WHERE c.owner_id = $1 OR cm.user_id = $1
		ORDER BY c.created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Course
	for rows.Next() {
		var c models.Course
		if err := rows.Scan(&c.ID, &c.Name, &c.Code, &c.OwnerID, &c.GroupSize, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// AddCourseMember enrolls a user into a course with a role. Uses ON CONFLICT
// to be idempotent when the enrollment already exists.
func (r *Repo) AddCourseMember(ctx context.Context, courseID, userID, role string) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO course_members (course_id, user_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (course_id, user_id) DO UPDATE SET role = EXCLUDED.role
	`, courseID, userID, role)
	return err
}

// GetCourseMemberRole returns the member role for a user in a course, or
// ErrNotFound when the user is not enrolled.
func (r *Repo) GetCourseMemberRole(ctx context.Context, courseID, userID string) (string, error) {
	var role string
	err := r.Pool.QueryRow(ctx, `
		SELECT role FROM course_members WHERE course_id = $1 AND user_id = $2
	`, courseID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return role, err
}
