// Command server is the ClassO backend entrypoint. It loads config, connects
// to Supabase Postgres, constructs the AI client, and mounts the REST API.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/classo/backend/internal/config"
	"github.com/classo/backend/internal/database"
	"github.com/classo/backend/internal/handlers"
	"github.com/classo/backend/internal/middleware"
	"github.com/classo/backend/internal/repository"
	"github.com/classo/backend/internal/services"
)

func main() {
	// 1. Load configuration from the environment.
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	// 2. Connect to Supabase Postgres.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close()

	// 3. Wire the dependency graph: repository -> services -> handlers.
	repo := repository.New(pool)
	aiClient := services.NewAIClient(cfg.ModelScopeAPIKey, cfg.ModelScopeModel)
	formationService := services.NewFormationService(repo, aiClient)
	summaryService := services.NewSummaryService(repo, aiClient)

	courseHandler := handlers.NewCourseHandler(repo, formationService)
	groupHandler := handlers.NewGroupHandler(repo, summaryService)
	fileHandler := handlers.NewFileHandler(repo, cfg)

	// 4. Mount the router with method-based paths (Go 1.22+ pattern syntax).
	mux := http.NewServeMux()

	// Health check.
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// Courses.
	mux.HandleFunc("GET /v1/courses", courseHandler.List)
	mux.HandleFunc("POST /v1/courses", courseHandler.Create)
	mux.HandleFunc("POST /v1/courses/{id}/form", courseHandler.Form)
	mux.HandleFunc("GET /v1/courses/{id}/groups", courseHandler.ListGroups)
	mux.HandleFunc("POST /v1/courses/{id}/members", courseHandler.AddMember)

	// Group workspace.
	mux.HandleFunc("GET /v1/groups/{id}/members", groupHandler.Members)
	mux.HandleFunc("GET /v1/groups/{id}/messages", groupHandler.Messages)
	mux.HandleFunc("POST /v1/groups/{id}/messages", groupHandler.SendMessage)
	mux.HandleFunc("GET /v1/groups/{id}/tasks", groupHandler.Tasks)
	mux.HandleFunc("POST /v1/groups/{id}/tasks", groupHandler.CreateTask)
	mux.HandleFunc("PATCH /v1/groups/{id}/tasks/{taskId}", groupHandler.UpdateTaskStatus)
	mux.HandleFunc("POST /v1/groups/{id}/summary", groupHandler.Summarize)
	mux.HandleFunc("GET /v1/groups/{id}/summary", groupHandler.LatestSummary)

	// File vault.
	mux.HandleFunc("POST /v1/groups/{id}/files", fileHandler.Upload)
	mux.HandleFunc("GET /v1/groups/{id}/files", fileHandler.List)

	// 5. Apply middleware: logging -> CORS -> auth.
	var root http.Handler = mux
	root = middleware.Logging(root)
	root = middleware.CORS(root)
	root = middleware.Auth(cfg, repo)(root)

	// 6. Run the HTTP server with graceful shutdown.
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           root,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("ClassO backend listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}
