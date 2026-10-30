// Role resolution against the Supabase Auth Admin API.
//
// Registration always creates a student, and an admin promotes a user by
// editing their role on the Supabase Dashboard (Auth → Users → the user →
// Metadata). The access-token JWT does NOT carry user_metadata by default, so
// the role must be read from the Admin API with the service-role key. This
// keeps the profiles table in sync with the role an admin set in the Dashboard,
// which is what the rest of the app (create course, instructor UI, etc.) trusts.
package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/classo/backend/internal/config"
	"github.com/classo/backend/internal/models"
)

// adminUser is the subset of the Supabase Admin API user shape we care about.
// app_metadata.role wins over user_metadata.role; both are checked because an
// admin may set the role in either place from the Dashboard. Email is the
// user's canonical address from Supabase Auth.
type adminUser struct {
	Email        string         `json:"email"`
	AppMetadata  map[string]any `json:"app_metadata"`
	UserMetadata map[string]any `json:"user_metadata"`
}

// resolveFromAdmin asks Supabase Auth for the user's canonical role and email.
// It returns zero values when the user is unknown or the Admin API is not
// configured/unreachable; callers fall back to the JWT claims.
func resolveFromAdmin(ctx context.Context, cfg *config.Config, userID string) (role, email string) {
	if cfg.SupabaseURL == "" || cfg.SupabaseServiceKey == "" || userID == "" {
		return "", ""
	}

	url := fmt.Sprintf("%s/auth/v1/admin/users/%s", cfg.SupabaseURL, userID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", ""
	}
	// The service-role key grants admin access to this endpoint. The apikey
	// header mirrors the anon-key convention; the service key doubles for both.
	req.Header.Set("Authorization", "Bearer "+cfg.SupabaseServiceKey)
	req.Header.Set("apikey", cfg.SupabaseServiceKey)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", ""
	}

	var u adminUser
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		return "", ""
	}
	return normalizeRole(roleFromMap(u.AppMetadata), roleFromMap(u.UserMetadata)), u.Email
}

// roleFromMap extracts a role string from a metadata map.
func roleFromMap(meta map[string]any) string {
	if meta == nil {
		return ""
	}
	if v, ok := meta["role"].(string); ok {
		return v
	}
	return ""
}

// normalizeRole returns the first of the given candidates that is a valid
// instructor/student role, or "" when none qualifies.
func normalizeRole(candidates ...string) string {
	for _, c := range candidates {
		switch c {
		case models.RoleInstructor, models.RoleStudent:
			return c
		}
	}
	return ""
}