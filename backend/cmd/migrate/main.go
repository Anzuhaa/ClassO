// Command migrate applies the SQL migrations under backend/migrations to the
// configured database. It is a lightweight, dependency-free (stdlib + pgx only)
// runner used during local development; in a production Supabase setup these
// files can also be run from the SQL editor.
//
// Usage:  DATABASE_URL=... go run ./cmd/migrate
//
// Each .sql file is split on ";\n" boundaries (the migrations contain no
// semicolons inside string literals or dollar-quoted bodies) and executed in
// lexical order. Statements are idempotent (IF NOT EXISTS / backfill guards),
// so running it repeatedly is safe.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	ctx := context.Background()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is not set")
	}

	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		log.Fatalf("parse DATABASE_URL: %v", err)
	}
	// Match the server's simple-protocol setting so the transaction pooler
	// (port 6543) handles cached prepared statements correctly.
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("ping: %v", err)
	}

	dir := "migrations"
	entries, err := os.ReadDir(dir)
	if err != nil {
		log.Fatalf("read migrations dir: %v", err)
	}

	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		path := filepath.Join(dir, name)
		raw, err := os.ReadFile(path)
		if err != nil {
			log.Fatalf("read %s: %v", name, err)
		}
		for _, stmt := range splitStatements(string(raw)) {
			if _, err := pool.Exec(ctx, stmt); err != nil {
				log.Fatalf("%s: %v\n--- statement ---\n%s", name, err, truncate(stmt, 400))
			}
		}
		fmt.Printf("applied %s\n", name)
	}

	fmt.Println("migrations complete")
}

// splitStatements splits SQL into executable statements, dropping blank lines
// and full-line comments. It tracks dollar-quoted PL/pgSQL bodies ($$ … $$) so
// internal semicolons inside function bodies don't split a statement apart.
func splitStatements(sql string) []string {
	var out []string
	var cur strings.Builder
	inDollarQuote := false
	flush := func() {
		s := strings.TrimSpace(cur.String())
		if s != "" && !onlyComments(s) {
			out = append(out, s)
		}
		cur.Reset()
	}
	for _, line := range strings.Split(sql, "\n") {
		trimmed := strings.TrimSpace(line)
		cur.WriteString(line)
		cur.WriteString("\n")

		// Toggle the dollar-quote state on $$ markers (function bodies).
		if strings.Contains(line, "$$") {
			inDollarQuote = !inDollarQuote
		}

		if !inDollarQuote && strings.HasSuffix(trimmed, ";") {
			flush()
		}
	}
	flush()
	return out
}

// onlyComments reports whether a statement block consists solely of comment
// lines (so it can be skipped as a no-op).
func onlyComments(s string) bool {
	for _, line := range strings.Split(s, "\n") {
		t := strings.TrimSpace(line)
		if t != "" && !strings.HasPrefix(t, "--") {
			return false
		}
	}
	return true
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}