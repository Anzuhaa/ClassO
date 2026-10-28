// Package config loads environment configuration for the ClassO backend.
//
// It centralizes all runtime settings (Supabase database, ModelScope AI,
// and HTTP server) so the rest of the application reads plain struct fields
// instead of touching os.Getenv directly.
package config

import (
	"fmt"
	"os"
)

// Config holds every setting the backend needs at runtime.
type Config struct {
	Port string // HTTP listen port, e.g. "8080".

	// Supabase/PostgreSQL connection.
	DatabaseURL string // Postgres connection string (pooler or direct).

	// Supabase project details (for JWT verification and storage).
	SupabaseURL        string // e.g. https://xyz.supabase.co
	SupabaseAnonKey    string // public anon key (used for JWT signing secret fallback)
	SupabaseServiceKey string // service-role key, used server-side for storage admin ops

	// ModelScope AI service.
	ModelScopeAPIKey string
	ModelScopeModel  string // e.g. deepseek-ai/DeepSeek-V4-Pro-0813

	// Feature toggles.
	AllowNoAuth bool // when true, seed a demo user so the app runs without Supabase Auth
}

// Load reads configuration from environment variables and applies defaults.
func Load() (*Config, error) {
	cfg := &Config{
		Port:               env("PORT", "8080"),
		DatabaseURL:        env("DATABASE_URL", ""),
		SupabaseURL:        env("SUPABASE_URL", ""),
		SupabaseAnonKey:    env("SUPABASE_ANON_KEY", ""),
		SupabaseServiceKey: env("SUPABASE_SERVICE_KEY", ""),
		ModelScopeAPIKey:   env("MODELSCOPE_API_KEY", ""),
		ModelScopeModel:    env("MODELSCOPE_MODEL", "deepseek-ai/DeepSeek-V4-Pro-0813"),
		AllowNoAuth:        env("ALLOW_NO_AUTH", "false") == "true",
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required (Supabase Postgres connection string)")
	}

	if cfg.ModelScopeAPIKey == "" {
		return nil, fmt.Errorf("MODELSCOPE_API_KEY is required for AI group balancing and summaries")
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
