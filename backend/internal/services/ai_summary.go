package services

import (
	"context"
	"fmt"
	"strings"

	"github.com/classo/backend/internal/models"
)

// summaryPrompt instructs the model to condense chat into a structured,
// concise summary.
const summaryPrompt = `You are a meeting-notes assistant for a student project
discussion. Summarize the following group chat into a concise summary with:
- Key decisions made
- Action items (with assignee if mentioned)
- Open questions / blockers
Use Markdown bullet points. Be brief and factual; do not invent details.`

// buildSummaryUser renders recent messages as a "name: content" transcript.
func buildSummaryUser(messages []models.Message) string {
	var b strings.Builder
	for _, m := range messages {
		fmt.Fprintf(&b, "%s: %s\n", m.SenderName, m.Content)
	}
	return b.String()
}

// SummarizeMessages asks the model for a summary of the given messages. On
// API failure it returns a plain concatenation fallback so the caller still
// receives a usable (if less polished) summary.
func (c *AIClient) SummarizeMessages(ctx context.Context, messages []models.Message) (string, error) {
	user := buildSummaryUser(messages)
	summary, err := c.Complete(ctx, summaryPrompt, user)
	if err != nil {
		return fallbackSummary(messages), nil
	}
	return summary, nil
}

// fallbackSummary produces a minimal transcript when the model is unavailable,
// preserving recent messages as a flat list rather than failing the request.
func fallbackSummary(messages []models.Message) string {
	if len(messages) == 0 {
		return "No messages to summarize yet."
	}
	var b strings.Builder
	b.WriteString("_Summary unavailable (AI service unreachable). Recent messages:_\n")
	// Show at most the last 10 lines to avoid a huge fallback.
	start := 0
	if len(messages) > 10 {
		start = len(messages) - 10
	}
	for _, m := range messages[start:] {
		fmt.Fprintf(&b, "- %s: %s\n", m.SenderName, m.Content)
	}
	return b.String()
}
