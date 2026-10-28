// Package middleware provides HTTP middleware for auth, CORS, and logging.
package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/classo/backend/internal/config"
	"github.com/classo/backend/internal/models"
	"github.com/classo/backend/internal/repository"
)

// contextKey is a private key type for request-scoped values.
type contextKey string

const (
	// userIDKey stores the authenticated user id in the request context.
	userIDKey contextKey = "user_id"
	// userRoleKey stores the course role (instructor/student) when known.
	userRoleKey contextKey = "course_role"
)

// UserID extracts the authenticated user id from a request context.
func UserID(ctx context.Context) string {
	id, _ := ctx.Value(userIDKey).(string)
	return id
}

// CourseRole extracts the course role from a request context.
func CourseRole(ctx context.Context) string {
	role, _ := ctx.Value(userRoleKey).(string)
	return role
}

// demoUserID is the seeded user id used when ALLOW_NO_AUTH is enabled, so the
// app runs locally without Supabase Auth wired up.
const demoUserID = "00000000-0000-0000-0000-000000000001"

// Auth extracts the user identity and attaches it to the request context.
//
// It accepts a Supabase JWT (via Authorization: Bearer ...) and otherwise
// falls back to the demo user when ALLOW_NO_AUTH is enabled. In production
// (no auth + no fallback allowed) it rejects with 401.
func Auth(cfg *config.Config, repo *repository.Repo) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID := resolveIdentity(cfg, repo, r)
			if userID == "" {
				writeError(w, http.StatusUnauthorized, "unauthorized")
				return
			}

			ctx := context.WithValue(r.Context(), userIDKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// resolveIdentity returns the authenticated user id from the request.
//
// JWT verification against Supabase is performed when configured; otherwise
// the demo path applies. Production deployments should replace the stub with
// a real JWT verifier using the Supabase project's JWT secret.
func resolveIdentity(cfg *config.Config, repo *repository.Repo, r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		token := strings.TrimPrefix(authHeader, "Bearer ")
		if sub := verifySupabaseJWT(cfg, token); sub != "" {
			ensureProfile(repo, r, sub)
			return sub
		}
	}

	// Demo fallback: explicit user id header or the seeded demo user.
	if cfg.AllowNoAuth {
		id := r.Header.Get("X-User-Id")
		if id == "" {
			id = demoUserID
		}
		ensureProfile(repo, r, id)
		return id
	}
	return ""
}

// verifySupabaseJWT validates a Supabase-issued JWT and returns its "sub"
// (user id) claim.
//
// NOTE: full HS256 verification requires the JWT secret from the Supabase
// project settings. This scaffold leaves it as a documented stub for
// production teams to complete; it returns "" so demo mode can take over.
func verifySupabaseJWT(cfg *config.Config, token string) string {
	// TODO(production): decode + verify the HS256 signature using the
	// Supabase JWT secret, then return the "sub" claim.
	_ = token
	_ = cfg
	return ""
}

// ensureProfile lazily creates/updates the profiles row for the identified
// user so foreign keys resolve, using minimal placeholder data in demo mode.
func ensureProfile(repo *repository.Repo, r *http.Request, userID string) {
	p := models.Profile{
		ID:       userID,
		FullName: "Demo Student",
		Email:    userID + "@classo.local",
		Skills:   []string{},
	}
	// Best-effort; failures are non-fatal for the request path.
	_ = repo.UpsertProfile(r.Context(), p)
}

// writeError writes a JSON error envelope.
func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// CORS attaches permissive CORS headers for local development.
func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User-Id")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Logging logs each request with method and path.
func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
		fmt.Printf("%s %s\n", r.Method, r.URL.Path)
	})
}
