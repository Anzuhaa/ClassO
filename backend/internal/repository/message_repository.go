package repository

import (
	"context"

	"github.com/classo/backend/internal/models"
)

// CreateMessage inserts a chat message and returns it with id/timestamp.
func (r *Repo) CreateMessage(ctx context.Context, m models.Message) (*models.Message, error) {
	row := r.Pool.QueryRow(ctx, `
		INSERT INTO messages (group_id, sender_id, content)
		VALUES ($1, $2, $3)
		RETURNING id, group_id, sender_id, content, created_at
	`, m.GroupID, m.SenderID, m.Content)

	var out models.Message
	if err := row.Scan(&out.ID, &out.GroupID, &out.SenderID, &out.Content, &out.CreatedAt); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListMessages returns the most recent N messages in a group, oldest first,
// joined to the sender's name for direct display.
func (r *Repo) ListMessages(ctx context.Context, groupID string, limit int) ([]models.Message, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT m.id, m.group_id, m.sender_id, m.content, m.created_at, p.full_name
		FROM messages m
		JOIN profiles p ON p.id = m.sender_id
		WHERE m.group_id = $1
		ORDER BY m.created_at DESC, m.id DESC
		LIMIT $2
	`, groupID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.Message, 0)
	for rows.Next() {
		var m models.Message
		if err := rows.Scan(&m.ID, &m.GroupID, &m.SenderID, &m.Content, &m.CreatedAt, &m.SenderName); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	// Reverse so the newest message is last (chat-order).
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, rows.Err()
}