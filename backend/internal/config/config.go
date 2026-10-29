// Package config loads environment configuration for the ClassO backend.
//
// It centralizes all runtime settings (Supabase database, auth, storage, and
// HTTP server) so the rest of the application reads plain struct fields
// instead of touching os.Getenv directly.
package config

import (
	"fmt"
	"os"
	"strings"
)

// Config holds every setting the backend needs at runtime.
type Config struct {
	Port string // HTTP listen port, e.g. "8080".

	// Supabase/PostgreSQL connection.
	DatabaseURL string // Postgres connection string (pooler or direct).

	// Supabase project details (for JWT verification and storage).
	SupabaseURL        string // e.g. https://xyz.supabase.co
	SupabaseAnonKey    string // public anon key
	SupabaseJWTSecret  string // HS256 signing secret used to verify auth JWTs
	SupabaseServiceKey string // service-role key, used server-side for storage admin ops

	// Feature toggles.
	AllowNoAuth bool // when true, seed a demo user so the app runs without Supabase Auth

	// InstructorEmails is the allowlist of emails permitted to self-promote to
	// the instructor role via POST /v1/profiles/me/promote.
	InstructorEmails []string
}

// Load reads configuration from environment variables and applies defaults.
func Load() (*Config, error) {
	cfg := &Config{
		Port:               env("PORT", "8080"),
		DatabaseURL:        env("DATABASE_URL", ""),
		SupabaseURL:        env("SUPABASE_URL", ""),
		SupabaseAnonKey:    env("SUPABASE_ANON_KEY", ""),
		SupabaseJWTSecret:  env("SUPABASE_JWT_SECRET", ""),
		SupabaseServiceKey: env("SUPABASE_SERVICE_KEY", ""),
		AllowNoAuth:        env("ALLOW_NO_AUTH", "false") == "true",
		InstructorEmails:   splitCSV(env("INSTRUCTOR_EMAILS", "")),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required (Supabase Postgres connection string)")
	}

	return cfg, nil
}

// env returns the value of key, or fallback when the variable is unset or empty.
func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// splitCSV splits a comma-separated string into trimmed, non-empty parts,
// lowercased so comparisons can be case-insensitive.
func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, strings.ToLower(p))
		}
	}
	return out
}