package repository

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"

	"github.com/classo/backend/internal/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrNotFound is returned when a queried row does not exist.
var ErrNotFound = errors.New("record not found")

// joinCodeAlphabet holds the unambiguous characters used in join codes (no
// 0/O/1/I) so a 6-char code is trivially readable when shared aloud.
const joinCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// generateJoinCode returns a random 6-character join code using crypto/rand so
// codes are not guessable. Callers retry on the unique-constraint collision.
func generateJoinCode() (string, error) {
	const n = 6
	b := make([]byte, n)
	for i := range b {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(joinCodeAlphabet))))
		if err != nil {
			return "", err
		}
		b[i] = joinCodeAlphabet[idx.Int64()]
	}
	return string(b), nil
}

// courseColumns lists the SELECT columns shared by the course query methods so
// they stay in sync with the model's scan order.
const courseColumns = "id, name, COALESCE(code, ''), join_code, owner_id, group_size, created_at, updated_at"

func scanCourse(row pgx.Row) (*models.Course, error) {
	var c models.Course
	err := row.Scan(&c.ID, &c.Name, &c.Code, &c.JoinCode, &c.OwnerID, &c.GroupSize, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// CreateCourse inserts a course and returns it with generated id/timestamps.
// It generates a unique join_code, retrying on the rare collision.
func (r *Repo) CreateCourse(ctx context.Context, c models.Course) (*models.Course, error) {
	for attempt := 0; attempt < 5; attempt++ {
		code, err := generateJoinCode()
		if err != nil {
			return nil, err
		}
		row := r.Pool.QueryRow(ctx, `
			INSERT INTO courses (name, code, join_code, owner_id, group_size)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING `+courseColumns,
			c.Name, c.Code, code, c.OwnerID, c.GroupSize)

		var out models.Course
		if err := row.Scan(&out.ID, &out.Name, &out.Code, &out.JoinCode, &out.OwnerID, &out.GroupSize, &out.CreatedAt, &out.UpdatedAt); err != nil {
			// Retry only on a join_code uniqueness collision.
			if isUniqueViolation(err) {
				continue
			}
			return nil, err
		}
		return &out, nil
	}
	return nil, errors.New("failed to generate a unique join code")
}

// GetCourse fetches a course by id.
func (r *Repo) GetCourse(ctx context.Context, id string) (*models.Course, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT `+courseColumns+` FROM courses WHERE id = $1
	`, id)

	c, err := scanCourse(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// GetCourseByJoinCode fetches a course by its join code (case-insensitive).
func (r *Repo) GetCourseByJoinCode(ctx context.Context, joinCode string) (*models.Course, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT `+courseColumns+` FROM courses WHERE upper(join_code) = upper($1)
	`, joinCode)

	c, err := scanCourse(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// ListCourses returns every course the given user is a member of (owned or
// enrolled), used to populate the home dashboard.
func (r *Repo) ListCourses(ctx context.Context, userID string) ([]models.Course, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT DISTINCT c.id, c.name, COALESCE(c.code, ''), c.join_code, c.owner_id, c.group_size, c.created_at, c.updated_at
		FROM courses c
		LEFT JOIN course_members cm ON cm.course_id = c.id
		WHERE c.owner_id = $1 OR cm.user_id = $1
		ORDER BY c.created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.Course, 0)
	for rows.Next() {
		var c models.Course
		if err := rows.Scan(&c.ID, &c.Name, &c.Code, &c.JoinCode, &c.OwnerID, &c.GroupSize, &c.CreatedAt, &c.UpdatedAt); err != nil {
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

// CourseMemberView is a profile joined with its course role, for the roster.
type CourseMemberView struct {
	models.Profile
	CourseRole string `json:"courseRole"`
}

// ListCourseMembers returns the enrollment roster for a course: each member's
// profile (name, skills, role) joined with their per-course role.
func (r *Repo) ListCourseMembers(ctx context.Context, courseID string) ([]CourseMemberView, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT p.id, p.full_name, p.email, COALESCE(p.avatar_url, ''), p.skills,
		       COALESCE(p.role, 'student'), p.created_at, cm.role
		FROM course_members cm
		JOIN profiles p ON p.id = cm.user_id
		WHERE cm.course_id = $1
		ORDER BY p.full_name
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]CourseMemberView, 0)
	for rows.Next() {
		var m CourseMemberView
		if err := rows.Scan(&m.ID, &m.FullName, &m.Email, &m.AvatarURL, &m.Skills, &m.Role, &m.CreatedAt, &m.CourseRole); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListCoursesByOwner returns courses owned by a user, used to scope
// instructor-only actions (random assign, viewing join codes).
func (r *Repo) ListCoursesByOwner(ctx context.Context, ownerID string) ([]models.Course, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT `+courseColumns+`
		FROM courses WHERE owner_id = $1 ORDER BY created_at DESC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.Course, 0)
	for rows.Next() {
		var c models.Course
		if err := rows.Scan(&c.ID, &c.Name, &c.Code, &c.JoinCode, &c.OwnerID, &c.GroupSize, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// isUniqueViolation reports whether a pgx error is a unique-constraint
// violation (SQLSTATE 23505), used to retry join-code generation collisions.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
