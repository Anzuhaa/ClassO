// Package middleware provides HTTP middleware for auth, CORS, and logging.
package middleware

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
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
)

// UserID extracts the authenticated user id from a request context.
func UserID(ctx context.Context) string {
	id, _ := ctx.Value(userIDKey).(string)
	return id
}

// demoUserID is the seeded user id used when ALLOW_NO_AUTH is enabled, so the
// app runs locally without Supabase Auth wired up.
const demoUserID = "00000000-0000-0000-0000-000000000001"

// Auth extracts the user identity and attaches it to the request context.
//
// It verifies a Supabase-issued JWT from the Authorization header (HS256,
// signed with the project's JWT secret). When ALLOW_NO_AUTH is enabled and no
// valid token is present, it falls back to the seeded demo user so local
// development works without a Supabase project.
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

// resolveIdentity returns the authenticated user id from the request, or "".
func resolveIdentity(cfg *config.Config, repo *repository.Repo, r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		token := strings.TrimPrefix(authHeader, "Bearer ")
		if sub, email, role := verifySupabaseJWT(cfg.SupabaseJWTSecret, token); sub != "" {
			ensureProfile(cfg, repo, r, sub, email, role)
			return sub
		}
	}

	if cfg.AllowNoAuth {
		id := r.Header.Get("X-User-Id")
		if id == "" {
			id = demoUserID
		}
		ensureProfile(cfg, repo, r, id, "", "")
		return id
	}
	return ""
}

// jwtHeader is the decoded JWT header segment (unverified).
type jwtHeader struct {
	Alg string `json:"alg"`
}

// jwtClaims is the decoded JWT payload segment. Role is read from Supabase's
// user_metadata (or app_metadata) so an admin-set role can be synced into the
// profiles table on login; email is the user's canonical address (always
// present in Supabase access tokens) and is used to keep profiles.email in sync.
type jwtClaims struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Exp   int64  `json:"exp"`

	UserMetadata map[string]any `json:"user_metadata"`
	AppMetadata  map[string]any `json:"app_metadata"`
}

// roleFromClaims returns the instructor/student role carried in the JWT's
// metadata, or "" when none is present.
func roleFromClaims(c *jwtClaims) string {
	for _, meta := range []map[string]any{c.AppMetadata, c.UserMetadata} {
		if meta == nil {
			continue
		}
		if v, ok := meta["role"].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

// verifySupabaseJWT validates the HS256 signature of a Supabase-issued JWT and
// returns its "sub" (user id), email, and role claims, or ("", "", "") when
// invalid.
//
// The token is split into header.payload.signature; the signature is an HMAC-
// SHA256 over "header.payload" keyed with the project's JWT secret. Expiry is
// not enforced here (Supabase issues short-lived access tokens and refreshes
// are handled client-side), but malformed or unverifiable tokens are rejected.
func verifySupabaseJWT(secret, token string) (sub, email, role string) {
	if secret == "" {
		return "", "", ""
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", "", ""
	}

	signingInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingInput))
	expected := mac.Sum(nil)

	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(sig, expected) {
		return "", "", ""
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", "", ""
	}
	var claims jwtClaims
	if err := json.Unmarshal(payload, &claims); err != nil || claims.Sub == "" {
		return "", "", ""
	}
	return claims.Sub, claims.Email, roleFromClaims(&claims)
}

// ensureProfile lazily creates the profiles row for the identified user so
// foreign keys resolve, and keeps profiles.role and profiles.email in sync with
// the authoritative source. Role comes from the Supabase Auth Admin API (the
// role an admin set on the Dashboard), falling back to JWT metadata and then
// the seeded student default. Email comes from the JWT, falling back to the
// Admin API, then a local placeholder. Keeping email accurate matters because
// promotion (POST /profiles/me/promote) authorizes against the real address.
func ensureProfile(cfg *config.Config, repo *repository.Repo, r *http.Request, userID, jwtEmail, jwtRole string) {
	// Canonical role from Supabase Auth (admin-set). This is what an admin edits
	// on the Dashboard after signup, and it wins over the JWT metadata, which
	// does not carry user_metadata unless a custom claim is configured. The
	// Admin API response also carries the canonical email as an email fallback.
	adminRole, adminEmail := resolveFromAdmin(r.Context(), cfg, userID)
	role := normalizeRole(adminRole, jwtRole)

	email := strings.TrimSpace(jwtEmail)
	if email == "" {
		email = strings.TrimSpace(adminEmail)
	}

	existing, err := repo.GetProfile(r.Context(), userID)
	if err == nil && existing != nil {
		if role != "" && role != existing.Role {
			_, _ = repo.SetProfileRole(r.Context(), userID, role)
		}
		// Refresh a placeholder (or stale) email with the real address.
		if email != "" && email != existing.Email {
			_, _ = repo.SetProfileEmail(r.Context(), userID, email)
		}
		return
	}

	p := models.Profile{
		ID:       userID,
		FullName: "User",
		Email:    userID + "@classo.local",
		Role:     models.RoleStudent,
	}
	if email != "" {
		p.Email = email
	}
	if role == models.RoleInstructor || role == models.RoleStudent {
		p.Role = role
	}
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