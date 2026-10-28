package services

import (
	"context"
	"fmt"

	"github.com/classo/backend/internal/models"
	"github.com/classo/backend/internal/repository"
)

// SummaryWindowMax caps how many recent messages feed a summary request.
const SummaryWindowMax = 50

// SummaryService generates and persists AI chat summaries for a group.
type SummaryService struct {
	repo *repository.Repo
	ai   *AIClient
}

// NewSummaryService wires a SummaryService with its dependencies.
func NewSummaryService(repo *repository.Repo, ai *AIClient) *SummaryService {
	return &SummaryService{repo: repo, ai: ai}
}

// Generate fetches recent messages, summarizes them, stores the summary, and
// returns the stored record. It is triggered manually from the chat UI.
func (s *SummaryService) Generate(ctx context.Context, groupID string) (*models.AISummary, error) {
	messages, err := s.repo.ListRecentMessagesForSummary(ctx, groupID, SummaryWindowMax)
	if err != nil {
		return nil, fmt.Errorf("list messages: %w", err)
	}

	summary, err := s.ai.SummarizeMessages(ctx, messages)
	if err != nil {
		return nil, fmt.Errorf("summarize: %w", err)
	}

	var fromMessageID *string
	if len(messages) > 0 {
		last := messages[len(messages)-1].ID
		fromMessageID = &last
	}

	record := models.AISummary{
		GroupID:       groupID,
		FromMessageID: fromMessageID,
		Summary:       summary,
	}
	return s.repo.CreateAISummary(ctx, record)
}

// Latest returns the most recently persisted summary for a group, if any.
func (s *SummaryService) Latest(ctx context.Context, groupID string) (*models.AISummary, error) {
	return s.repo.GetLatestSummary(ctx, groupID)
}
