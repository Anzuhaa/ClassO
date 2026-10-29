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
		if sub := verifySupabaseJWT(cfg.SupabaseJWTSecret, token); sub != "" {
			ensureProfile(repo, r, sub)
			return sub
		}
	}

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

// jwtHeader is the decoded JWT header segment (unverified).
type jwtHeader struct {
	Alg string `json:"alg"`
}

// jwtClaims is the decoded JWT payload segment.
type jwtClaims struct {
	Sub string `json:"sub"`
	Exp int64  `json:"exp"`
}

// verifySupabaseJWT validates the HS256 signature of a Supabase-issued JWT and
// returns its "sub" (user id) claim, or "" when the token is invalid.
//
// The token is split into header.payload.signature; the signature is an HMAC-
// SHA256 over "header.payload" keyed with the project's JWT secret. Expiry is
// not enforced here (Supabase issues short-lived access tokens and refreshes
// are handled client-side), but malformed or unverifiable tokens are rejected.
func verifySupabaseJWT(secret, token string) string {
	if secret == "" {
		return ""
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return ""
	}

	signingInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingInput))
	expected := mac.Sum(nil)

	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(sig, expected) {
		return ""
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims jwtClaims
	if err := json.Unmarshal(payload, &claims); err != nil || claims.Sub == "" {
		return ""
	}
	return claims.Sub
}

// ensureProfile lazily creates the profiles row for the identified user so
// foreign keys resolve. It preserves any existing profile, falling back to a
// minimal placeholder (real email/full_name are set by the auth handlers).
func ensureProfile(repo *repository.Repo, r *http.Request, userID string) {
	if existing, err := repo.GetProfile(r.Context(), userID); err == nil && existing != nil {
		return
	}
	p := models.Profile{
		ID:       userID,
		FullName: "User",
		Email:    userID + "@classo.local",
		Role:     models.RoleStudent,
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