// Package handler exposes HTTP endpoints and maps them to service calls.
// Handlers stay thin: parse input, delegate to services, write JSON output.
package handlers

import (
	"encoding/json"
	"net/http"
	"time"
)

// maxJSONBodyBytes caps the size of a JSON request body so a client cannot send
// an unbounded payload into a handler's decoder. Chat messages, task titles,
// and course fields are all far smaller than this ceiling.
const maxJSONBodyBytes = 1 << 20 // 1 MiB

// writeJSON serializes v as JSON with the given status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError writes a JSON error envelope.
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// decodeJSON parses the request body into dst, returning false (after writing
// a 400) when the body is malformed. The body is capped to maxJSONBodyBytes so
// a client cannot stream an arbitrarily large payload into a decoder.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

// parseTime converts a RFC3339 string into a time.Time, tolerating a trailing
// "Z" or explicit offset as produced by the frontend's toISOString().
func parseTime(s string) (time.Time, error) {
	return time.Parse(time.RFC3339, s)
}
