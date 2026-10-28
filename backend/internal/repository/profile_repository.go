package repository

import (
	"context"

	"github.com/classo/backend/internal/models"
)

// UpsertProfile inserts or updates a profile row (triggered on first login)
// keyed by the Supabase Auth user id.
func (r *Repo) UpsertProfile(ctx context.Context, p models.Profile) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO profiles (id, full_name, email, avatar_url, skills)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (id) DO UPDATE SET
			full_name  = EXCLUDED.full_name,
			email      = EXCLUDED.email,
			avatar_url = EXCLUDED.avatar_url,
			updated_at = now()
	`, p.ID, p.FullName, p.Email, p.AvatarURL, p.Skills)
	return err
}

// GetProfile fetches a single profile by id.
func (r *Repo) GetProfile(ctx context.Context, id string) (*models.Profile, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT id, full_name, email, COALESCE(avatar_url, ''), skills, created_at
		FROM profiles WHERE id = $1
	`, id)

	var p models.Profile
	if err := row.Scan(&p.ID, &p.FullName, &p.Email, &p.AvatarURL, &p.Skills, &p.CreatedAt); err != nil {
		return nil, err
	}
	return &p, nil
}

// ListProfilesByCourse returns all profiles enrolled in a course, joined
// through course_members so group formation has the full roster + skills.
func (r *Repo) ListProfilesByCourse(ctx context.Context, courseID string) ([]models.Profile, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT p.id, p.full_name, p.email, COALESCE(p.avatar_url, ''), p.skills, p.created_at
		FROM profiles p
		JOIN course_members cm ON cm.user_id = p.id
		WHERE cm.course_id = $1
		ORDER BY p.full_name
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Profile
	for rows.Next() {
		var p models.Profile
		if err := rows.Scan(&p.ID, &p.FullName, &p.Email, &p.AvatarURL, &p.Skills, &p.CreatedAt); err != nil {
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
		SELECT p.id, p.full_name, p.email, COALESCE(p.avatar_url, ''), p.skills, p.created_at
		FROM profiles p
		JOIN group_members gm ON gm.user_id = p.id
		WHERE gm.group_id = $1
		ORDER BY p.full_name
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Profile
	for rows.Next() {
		var p models.Profile
		if err := rows.Scan(&p.ID, &p.FullName, &p.Email, &p.AvatarURL, &p.Skills, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
