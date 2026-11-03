package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/classo/backend/internal/models"
)

// ChatHub is an in-memory pub/sub bus for group chat. Each group has a set of
// subscriber channels; broadcasting a message fans it out to every subscriber
// so clients receive new posts as server-sent events (SSE) without polling.
//
// It is a process-local hub: all members of a group must be served by the same
// backend instance to see live updates. For a single-instance deployment this
// is correct and simpler than wiring a shared broker.
type ChatHub struct {
	mu   sync.Mutex
	subs map[string]map[chan chatEvent]struct{}
}

// chatEvent is one entry pushed down an SSE stream: either a full chat message
// or an ephemeral "typing" presence ping (no persistence, never replayed).
type chatEvent struct {
	kind string // "message" or "typing"
	data any    // models.Message or typingSignal
}

// typingSignal is the wire payload for a "typing" presence event. It carries
// just enough to render an indicator: who is typing and a coarse timestamp.
type typingSignal struct {
	GroupID string `json:"groupId"`
	UserID  string `json:"userId"`
	Name    string `json:"name"`
	At      int64  `json:"at"` // unix milliseconds
}

// NewChatHub returns an empty hub.
func NewChatHub() *ChatHub {
	return &ChatHub{
		subs: make(map[string]map[chan chatEvent]struct{}),
	}
}

// subscribe registers a channel to receive events for groupID and returns an
// unsubscribe func. The channel is buffered so a slow client never blocks the
// broadcaster; callers should drain it promptly.
func (h *ChatHub) subscribe(groupID string, ch chan chatEvent) func() {
	h.mu.Lock()
	defer h.mu.Unlock()
	group := h.subs[groupID]
	if group == nil {
		group = make(map[chan chatEvent]struct{})
		h.subs[groupID] = group
	}
	group[ch] = struct{}{}
	return func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		delete(group, ch)
		if len(group) == 0 {
			delete(h.subs, groupID)
		}
	}
}

// publish delivers an event to every subscriber of its group. Delivery to a
// full subscriber buffer is dropped (non-blocking) so a stalled client cannot
// stall the server.
func (h *ChatHub) publish(groupID, kind string, data any) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[groupID] {
		select {
		case ch <- chatEvent{kind: kind, data: data}:
		default:
		}
	}
}

// PublishMessage delivers a full chat message to a group's subscribers.
func (h *ChatHub) PublishMessage(m models.Message) {
	h.publish(m.GroupID, "message", m)
}

// PublishTyping delivers a transient "typing" presence ping to a group's
// subscribers. The payload is intentionally tiny; it is never persisted.
func (h *ChatHub) PublishTyping(sig typingSignal) {
	h.publish(sig.GroupID, "typing", sig)
}

// MessageStream is the SSE endpoint for live chat: it authenticates as a group
// member, upgrades to a text/event-stream response, and forwards each new
// message (and transient typing ping) in the group as it is posted. The
// connection ends when the client disconnects or the request context is
// cancelled.
func (h *GroupHandler) MessageStream(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("id")
	if !h.requireGroupMember(w, r, groupID) {
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// A buffered channel lets the hub deliver without blocking a slow client;
	// the loop below drains it as fast as it can write.
	ch := make(chan chatEvent, 32)
	unsub := h.hub.subscribe(groupID, ch)
	defer unsub()

	// Heartbeat every 15s so intermediaries and clients see the stream is alive
	// even during quiet periods.
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case ev := <-ch:
			if err := writeSSE(w, ev.kind, ev.data); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// writeSSE encodes one event as an SSE frame. A client that drops and
// reconnects re-fetches the backlog via GET /messages, so ordering gaps are
// self-healing; each event carries the full canonical payload so the client
// renders it without another fetch.
func writeSSE(w http.ResponseWriter, kind string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", kind, b)
	return err
}