package repository

import (
	"context"

	"github.com/classo/backend/internal/models"
	"github.com/jackc/pgx/v5"
)

// CreateFile records a vault file's metadata (the actual bytes live in
// Supabase Storage under storage_path).
func (r *Repo) CreateFile(ctx context.Context, f models.File) (*models.File, error) {
	row := r.Pool.QueryRow(ctx, `
		INSERT INTO files (group_id, uploader_id, name, storage_path, size, mime_type)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, group_id, uploader_id, name, storage_path, size, COALESCE(mime_type, ''), created_at
	`, f.GroupID, f.UploaderID, f.Name, f.StoragePath, f.Size, f.MimeType)

	var out models.File
	if err := row.Scan(&out.ID, &out.GroupID, &out.UploaderID, &out.Name, &out.StoragePath, &out.Size, &out.MimeType, &out.CreatedAt); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListFiles returns all files in a group's vault, newest first, joined to the
// uploader's name.
func (r *Repo) ListFiles(ctx context.Context, groupID string) ([]models.File, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT f.id, f.group_id, f.uploader_id, f.name, f.storage_path, f.size,
		       COALESCE(f.mime_type, ''), f.created_at, p.full_name
		FROM files f
		JOIN profiles p ON p.id = f.uploader_id
		WHERE f.group_id = $1
		ORDER BY f.created_at DESC
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.File, 0)
	for rows.Next() {
		var f models.File
		if err := rows.Scan(&f.ID, &f.GroupID, &f.UploaderID, &f.Name, &f.StoragePath, &f.Size, &f.MimeType, &f.CreatedAt, &f.UploaderName); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// GetFile fetches a single file's metadata by id.
func (r *Repo) GetFile(ctx context.Context, id string) (*models.File, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT id, group_id, uploader_id, name, storage_path, size, COALESCE(mime_type, ''), created_at
		FROM files WHERE id = $1
	`, id)

	var f models.File
	if err := row.Scan(&f.ID, &f.GroupID, &f.UploaderID, &f.Name, &f.StoragePath, &f.Size, &f.MimeType, &f.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &f, nil
}
