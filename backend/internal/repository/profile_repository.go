package repository

import (
	"context"
	"errors"

	"github.com/classo/backend/internal/models"
	"github.com/jackc/pgx/v5"
)

// UpsertProfile inserts or updates a profile row (triggered on login/signup)
// keyed by the Supabase Auth user id.
func (r *Repo) UpsertProfile(ctx context.Context, p models.Profile) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO profiles (id, full_name, email, avatar_url, role)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (id) DO UPDATE SET
			full_name  = EXCLUDED.full_name,
			email      = EXCLUDED.email,
			avatar_url = EXCLUDED.avatar_url,
			role       = EXCLUDED.role,
			updated_at = now()
	`, p.ID, p.FullName, p.Email, p.AvatarURL, p.Role)
	return err
}

// SetProfileRole updates only the role column for a profile, returning the
// refreshed row. Used by the instructor self-promotion endpoint.
func (r *Repo) SetProfileRole(ctx context.Context, id, role string) (*models.Profile, error) {
	row := r.Pool.QueryRow(ctx, `
		UPDATE profiles SET role = $1, updated_at = now()
		WHERE id = $2
		RETURNING id, full_name, email, COALESCE(avatar_url, ''), COALESCE(role, 'student'), created_at
	`, role, id)

	var p models.Profile
	if err := row.Scan(&p.ID, &p.FullName, &p.Email, &p.AvatarURL, &p.Role, &p.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

// SetProfileEmail updates only the email column for a profile, returning the
// refreshed row. Used to backfill the placeholder address with the real Supabase
// Auth email so allowlist checks (e.g. instructor promotion) match correctly.
func (r *Repo) SetProfileEmail(ctx context.Context, id, email string) (*models.Profile, error) {
	row := r.Pool.QueryRow(ctx, `
		UPDATE profiles SET email = $1, updated_at = now()
		WHERE id = $2
		RETURNING id, full_name, email, COALESCE(avatar_url, ''), COALESCE(role, 'student'), created_at
	`, email, id)

	var p models.Profile
	if err := row.Scan(&p.ID, &p.FullName, &p.Email, &p.AvatarURL, &p.Role, &p.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

// SetProfileAvatarURL updates only the avatar_url column for a profile,
// returning the refreshed row. Used by the avatar upload endpoint.
func (r *Repo) SetProfileAvatarURL(ctx context.Context, id, avatarURL string) (*models.Profile, error) {
	row := r.Pool.QueryRow(ctx, `
		UPDATE profiles SET avatar_url = $1, updated_at = now()
		WHERE id = $2
		RETURNING id, full_name, email, COALESCE(avatar_url, ''), COALESCE(role, 'student'), created_at
	`, avatarURL, id)

	var p models.Profile
	if err := row.Scan(&p.ID, &p.FullName, &p.Email, &p.AvatarURL, &p.Role, &p.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

// GetProfile fetches a single profile by id.
func (r *Repo) GetProfile(ctx context.Context, id string) (*models.Profile, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT id, full_name, email, COALESCE(avatar_url, ''), COALESCE(role, 'student'), created_at
		FROM profiles WHERE id = $1
	`, id)

	var p models.Profile
	if err := row.Scan(&p.ID, &p.FullName, &p.Email, &p.AvatarURL, &p.Role, &p.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

// GetProfileByEmail fetches a single profile by email (case-insensitive).
func (r *Repo) GetProfileByEmail(ctx context.Context, email string) (*models.Profile, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT id, full_name, email, COALESCE(avatar_url, ''), COALESCE(role, 'student'), created_at
		FROM profiles WHERE lower(email) = lower($1)
	`, email)

	var p models.Profile
	if err := row.Scan(&p.ID, &p.FullName, &p.Email, &p.AvatarURL, &p.Role, &p.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

// ListProfilesByCourse returns all profiles enrolled in a course, joined
// through course_members so group formation has the full roster.
func (r *Repo) ListProfilesByCourse(ctx context.Context, courseID string) ([]models.Profile, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT p.id, p.full_name, p.email, COALESCE(p.avatar_url, ''), COALESCE(p.role, 'student'), p.created_at
		FROM profiles p
		JOIN course_members cm ON cm.user_id = p.id
		WHERE cm.course_id = $1
		ORDER BY p.full_name
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.Profile, 0)
	for rows.Next() {
		var p models.Profile
		if err := rows.Scan(&p.ID, &p.FullName, &p.Email, &p.AvatarURL, &p.Role, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListStudentsByCourse returns only the student profiles enrolled in a course
// (excluding instructors), used for random group assignment so instructors are
// never placed into student groups.
func (r *Repo) ListStudentsByCourse(ctx context.Context, courseID string) ([]models.Profile, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT p.id, p.full_name, p.email, COALESCE(p.avatar_url, ''), COALESCE(p.role, 'student'), p.created_at
		FROM profiles p
		JOIN course_members cm ON cm.user_id = p.id
		WHERE cm.course_id = $1 AND cm.role = $2
		ORDER BY p.full_name
	`, courseID, models.RoleStudent)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.Profile, 0)
	for rows.Next() {
		var p models.Profile
		if err := rows.Scan(&p.ID, &p.FullName, &p.Email, &p.AvatarURL, &p.Role, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListProfilesByGroup returns all profiles in a group, joined through
// group_members, used for chat senders and task assignees.
func (r *Repo) ListProfilesByGroup(ctx context.Context, groupID string) ([]models.Profile, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT p.id, p.full_name, p.email, COALESCE(p.avatar_url, ''), COALESCE(p.role, 'student'), p.created_at
		FROM profiles p
		JOIN group_members gm ON gm.user_id = p.id
		WHERE gm.group_id = $1
		ORDER BY p.full_name
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.Profile, 0)
	for rows.Next() {
		var p models.Profile
		if err := rows.Scan(&p.ID, &p.FullName, &p.Email, &p.AvatarURL, &p.Role, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListGroupMemberViews returns each profile in a group with its group role,
// ordered with the lead first, then by name.
func (r *Repo) ListGroupMemberViews(ctx context.Context, groupID string) ([]models.GroupMemberView, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT p.id, p.full_name, p.email, COALESCE(p.avatar_url, ''), COALESCE(p.role, 'student'), p.created_at, gm.role
		FROM group_members gm
		JOIN profiles p ON p.id = gm.user_id
		WHERE gm.group_id = $1
		ORDER BY (gm.role = 'lead') DESC, p.full_name
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.GroupMemberView, 0)
	for rows.Next() {
		var v models.GroupMemberView
		if err := rows.Scan(&v.ID, &v.FullName, &v.Email, &v.AvatarURL, &v.Role, &v.CreatedAt, &v.GroupRole); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// GroupMemberProfile is a profile plus the group id it belongs to and the
// member's group role, used to batch-load the rosters of every group in a
// course in a single query.
type GroupMemberProfile struct {
	GroupID string
	models.GroupMemberView
}

// ListGroupMemberProfilesByCourse returns every group member's profile across a
// course, tagged with their group id and group role, in one round-trip. The
// caller partitions by GroupID to reconstruct each group's roster without an
// N+1 query per group.
func (r *Repo) ListGroupMemberProfilesByCourse(ctx context.Context, courseID string) ([]GroupMemberProfile, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT gm.group_id, p.id, p.full_name, p.email, COALESCE(p.avatar_url, ''), COALESCE(p.role, 'student'), p.created_at, gm.role
		FROM group_members gm
		JOIN profiles p ON p.id = gm.user_id
		WHERE gm.course_id = $1
		ORDER BY gm.group_id, (gm.role = 'lead') DESC, p.full_name
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]GroupMemberProfile, 0)
	for rows.Next() {
		var e GroupMemberProfile
		if err := rows.Scan(&e.GroupID, &e.ID, &e.FullName, &e.Email, &e.AvatarURL, &e.Role, &e.CreatedAt, &e.GroupRole); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ListProfiles returns all profiles (limited utility; used by admin/demo only).
func (r *Repo) ListProfiles(ctx context.Context) ([]models.Profile, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT id, full_name, email, COALESCE(avatar_url, ''), COALESCE(role, 'student'), created_at
		FROM profiles ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.Profile, 0)
	for rows.Next() {
		var p models.Profile
		if err := rows.Scan(&p.ID, &p.FullName, &p.Email, &p.AvatarURL, &p.Role, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
