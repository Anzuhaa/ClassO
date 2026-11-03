package handlers

import (
	"testing"
	"time"

	"github.com/classo/backend/internal/models"
)

func TestChatHubPublishTypingFanout(t *testing.T) {
	h := NewChatHub()
	ch := make(chan chatEvent, 4)
	unsub := h.subscribe("g1", ch)
	defer unsub()

	h.PublishTyping(typingSignal{GroupID: "g1", UserID: "u1", Name: "Alice", At: 123})

	select {
	case ev := <-ch:
		if ev.kind != "typing" {
			t.Fatalf("kind = %q, want typing", ev.kind)
		}
		sig, ok := ev.data.(typingSignal)
		if !ok || sig.Name != "Alice" {
			t.Fatalf("data = %#v, want typingSignal{Name:Alice}", ev.data)
		}
	case <-time.After(time.Second):
		t.Fatal("no typing event received on subscriber channel")
	}
}

func TestChatHubMessageAndTypingShareSubscriber(t *testing.T) {
	h := NewChatHub()
	ch := make(chan chatEvent, 4)
	unsub := h.subscribe("g1", ch)
	defer unsub()

	h.PublishMessage(models.Message{GroupID: "g1", Content: "hi"})
	h.PublishTyping(typingSignal{GroupID: "g1", UserID: "u2"})

	kinds := map[string]bool{}
	for i := 0; i < 2; i++ {
		select {
		case ev := <-ch:
			kinds[ev.kind] = true
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for events")
		}
	}
	if !kinds["message"] || !kinds["typing"] {
		t.Fatalf("expected both message and typing events, got %v", kinds)
	}
}
