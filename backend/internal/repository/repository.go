// Package repository encapsulates all SQL access to the Supabase Postgres
// database. Handlers and services depend on these interfaces rather than on
// raw SQL, keeping data access isolated and testable.
package repository

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repo bundles every repository behind one dependency that services inject.
type Repo struct {
	Pool *pgxpool.Pool
}

// New returns a Repo wrapping the given connection pool.
func New(pool *pgxpool.Pool) *Repo {
	return &Repo{Pool: pool}
}

// tx executes fn inside a database transaction, committing on success and
// rolling back on any error. It is the single source of transactional truth.
func (r *Repo) tx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
