// Package service contains the AI integration: a client for the ModelScope
// (DashScope) text-generation API and helpers that build prompts and parse
// structured responses for group balancing and chat summarization.
package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// modelScopeURL is the DashScope text-generation endpoint.
const (
	modelScopeURL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation"
)

// AIClient wraps the ModelScope HTTP API with the configured key and model.
type AIClient struct {
	apiKey     string
	model      string
	httpClient *http.Client
}

// NewAIClient builds an AIClient with a sensible timeout.
func NewAIClient(apiKey, model string) *AIClient {
	return &AIClient{
		apiKey: apiKey,
		model:  model,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// chatRequest is the DashScope text-generation request body.
type chatRequest struct {
	Model      string         `json:"model"`
	Input      chatInput      `json:"input"`
	Parameters chatParameters `json:"parameters"`
}

type chatInput struct {
	Messages []chatMessage `json:"messages"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatParameters struct {
	ResultFormat string `json:"result_format"` // "message" returns assistant text
}

// chatResponse is the DashScope response envelope.
type chatResponse struct {
	Output struct {
		Choices []struct {
			Message chatMessage `json:"message"`
		} `json:"choices"`
	} `json:"output"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Complete sends a system+user prompt to ModelScope and returns the model's
// assistant text. The API key and requests never leave the backend.
func (c *AIClient) Complete(ctx context.Context, system, user string) (string, error) {
	reqBody := chatRequest{
		Model: c.model,
		Input: chatInput{
			Messages: []chatMessage{
				{Role: "system", Content: system},
				{Role: "user", Content: user},
			},
		},
		Parameters: chatParameters{ResultFormat: "message"},
	}

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, modelScopeURL, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("post request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("modelScope returned %d: %s", resp.StatusCode, truncate(string(body), 300))
	}

	var out chatResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}
	if out.Code != "" && out.Code != "OK" {
		return "", fmt.Errorf("modelScope error %s: %s", out.Code, out.Message)
	}
	if len(out.Output.Choices) == 0 {
		return "", fmt.Errorf("modelScope returned no choices")
	}
	return out.Output.Choices[0].Message.Content, nil
}

// completeJSON asks the model for JSON and extracts the first balanced
// { ... } object from the response, tolerating prose around it.
func (c *AIClient) completeJSON(ctx context.Context, system, user string) (string, error) {
	raw, err := c.Complete(ctx, system, user)
	if err != nil {
		return "", err
	}
	return extractJSONObject(raw), nil
}

// extractJSONObject finds the outermost balanced { ... } in s. It returns the
// substring including braces, or an empty string when none is balanced.
func extractJSONObject(s string) string {
	start := strings.IndexByte(s, '{')
	if start == -1 {
		return ""
	}
	depth := 0
	for i := start; i < len(s); i++ {
		switch s[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return s[start : i+1]
			}
		}
	}
	return ""
}

// truncate shortens s to n runes for safe logging.
func truncate(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}
