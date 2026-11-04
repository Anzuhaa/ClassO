// Command server is the ClassO backend entrypoint. It loads config, connects
// to Supabase Postgres, and mounts the REST API.
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
	formationService := services.NewFormationService(repo)

	courseHandler := handlers.NewCourseHandler(repo, formationService)
	groupHandler := handlers.NewGroupHandler(repo)
	fileHandler := handlers.NewFileHandler(repo, cfg)
	profileHandler := handlers.NewProfileHandler(repo, cfg)

	// 4. Mount the router with method-based paths (Go 1.22+ pattern syntax).
	mux := http.NewServeMux()

	// Health check.
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// Username availability (pre-registration, unauthenticated).
	mux.HandleFunc("GET /v1/auth/check-username", profileHandler.CheckUsername)

	// Profiles (self-service; email/password live in Supabase Auth).
	mux.HandleFunc("GET /v1/profiles/me", profileHandler.Me)
	mux.HandleFunc("PATCH /v1/profiles/me", profileHandler.Update)
	mux.HandleFunc("POST /v1/profiles/me/promote", profileHandler.Promote)
	mux.HandleFunc("POST /v1/profiles/me/avatar", profileHandler.UploadAvatar)

	// Courses.
	mux.HandleFunc("GET /v1/courses", courseHandler.List)
	mux.HandleFunc("POST /v1/courses", courseHandler.Create)
	mux.HandleFunc("POST /v1/courses/join", courseHandler.JoinByCode)
	mux.HandleFunc("GET /v1/courses/{id}", courseHandler.Get)
	mux.HandleFunc("DELETE /v1/courses/{id}", courseHandler.Delete)
	mux.HandleFunc("POST /v1/courses/{id}/join-code", courseHandler.RegenerateJoinCode)
	mux.HandleFunc("DELETE /v1/courses/{id}/join-code", courseHandler.ExpireJoinCode)
	mux.HandleFunc("POST /v1/courses/{id}/random-assign", courseHandler.RandomAssign)
	mux.HandleFunc("POST /v1/courses/{id}/groups", groupHandler.CreateGroup)
	mux.HandleFunc("GET /v1/courses/{id}/groups", courseHandler.ListGroups)
	mux.HandleFunc("GET /v1/courses/{id}/members", courseHandler.Members)
	mux.HandleFunc("DELETE /v1/courses/{id}/members", courseHandler.RemoveMember)
	mux.HandleFunc("GET /v1/courses/{id}/my-group", courseHandler.MyGroup)
	mux.HandleFunc("POST /v1/courses/{id}/members", courseHandler.AddMember)
	mux.HandleFunc("POST /v1/courses/{id}/lock", courseHandler.SetLock)
	mux.HandleFunc("GET /v1/courses/{id}/join-requests", groupHandler.ListJoinRequests)
	mux.HandleFunc("POST /v1/courses/{id}/join-requests/{requestId}/approve", groupHandler.ApproveJoinRequest)
	mux.HandleFunc("POST /v1/courses/{id}/join-requests/{requestId}/reject", groupHandler.RejectJoinRequest)

	// Group workspace.
	mux.HandleFunc("GET /v1/groups/{id}/members", groupHandler.Members)
	mux.HandleFunc("POST /v1/groups/{id}/join", groupHandler.Join)
	mux.HandleFunc("POST /v1/groups/{id}/leave", groupHandler.LeaveGroup)
	mux.HandleFunc("DELETE /v1/groups/{id}/members", groupHandler.RemoveMember)
	mux.HandleFunc("DELETE /v1/groups/{id}", groupHandler.DeleteGroup)
	mux.HandleFunc("GET /v1/groups/{id}", groupHandler.Get)
	mux.HandleFunc("PATCH /v1/groups/{id}", groupHandler.Rename)
	mux.HandleFunc("PUT /v1/groups/{id}/lead", groupHandler.SetLead)
	mux.HandleFunc("GET /v1/groups/{id}/messages", groupHandler.Messages)
	mux.HandleFunc("POST /v1/groups/{id}/messages", groupHandler.SendMessage)
	mux.HandleFunc("GET /v1/groups/{id}/messages/stream", groupHandler.MessageStream)
	mux.HandleFunc("POST /v1/groups/{id}/typing", groupHandler.Typing)
	mux.HandleFunc("GET /v1/groups/{id}/tasks", groupHandler.Tasks)
	mux.HandleFunc("POST /v1/groups/{id}/tasks", groupHandler.CreateTask)
	mux.HandleFunc("PATCH /v1/groups/{id}/tasks/{taskId}", groupHandler.UpdateTaskStatus)
	mux.HandleFunc("PUT /v1/groups/{id}/tasks/{taskId}/assignees", groupHandler.UpdateTaskAssignees)

	// File vault.
	mux.HandleFunc("POST /v1/groups/{id}/files", fileHandler.Upload)
	mux.HandleFunc("GET /v1/groups/{id}/files", fileHandler.List)
	mux.HandleFunc("PATCH /v1/groups/{id}/files/{fileId}", fileHandler.Rename)
	mux.HandleFunc("DELETE /v1/groups/{id}/files/{fileId}", fileHandler.Delete)
	mux.HandleFunc("GET /v1/groups/{id}/files/{fileId}/url", fileHandler.URL)
	mux.HandleFunc("GET /v1/groups/{id}/files/{fileId}/download", fileHandler.Download)

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