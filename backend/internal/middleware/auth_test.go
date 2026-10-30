// Tests for Supabase JWT verification (ES256 via JWKS and legacy HS256).
package middleware

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/classo/backend/internal/config"
)

// b64u encodes data with base64url, no padding (JWT segment encoding).
func b64u(data []byte) string {
	return base64.RawURLEncoding.EncodeToString(data)
}

// signES256 builds a compact JWT whose header declares ES256 with the given kid
// and signs it with the provided P-256 private key. The signature is the raw
// 64-byte R||S concatenation that a JWT expects (not ASN.1/DER).
func signES256(t *testing.T, key *ecdsa.PrivateKey, kid string, claims map[string]any) string {
	t.Helper()

	hdrBytes, err := json.Marshal(map[string]string{"alg": "ES256", "typ": "JWT", "kid": kid})
	if err != nil {
		t.Fatalf("marshal header: %v", err)
	}
	claimsBytes, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}

	signingInput := b64u(hdrBytes) + "." + b64u(claimsBytes)
	digest := sha256.Sum256([]byte(signingInput))

	r, s, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	// JWT ES256 signature is R||S, both 32-byte big-endian, zero-padded.
	var sig [64]byte
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])

	return signingInput + "." + b64u(sig[:])
}

// newJWKSServer generates a fresh P-256 key and serves a JWKS document exposing
// its public key under the given kid. It returns the server URL, the private key
// (for signing test tokens), and a cleanup func.
func newJWKSServer(t *testing.T, kid string) (string, *ecdsa.PrivateKey, func()) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	x := make([]byte, 32)
	y := make([]byte, 32)
	key.PublicKey.X.FillBytes(x)
	key.PublicKey.Y.FillBytes(y)

	doc := jwksJSON{
		Keys: []jwksJSONKey{{
			Kid: kid,
			Kty: "EC",
			Crv: "P-256",
			X:   b64u(x),
			Y:   b64u(y),
		}},
	}
	body, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal jwks: %v", err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))

	return srv.URL, key, srv.Close
}

// resetJWKS reinitializes the package-level JWKS cache between tests.
func resetJWKS() {
	supabaseJWKS = &jwksCache{}
}

func TestVerifyES256(t *testing.T) {
	resetJWKS()
	url, key, closeFn := newJWKSServer(t, "k1")
	defer closeFn()

	claims := map[string]any{
		"sub":   "user-123",
		"email": "user@test.com",
	}
	token := signES256(t, key, "k1", claims)

	cfg := &config.Config{SupabaseURL: url}

	sub, email, role := verifySupabaseJWT(cfg, token)
	if sub != "user-123" {
		t.Fatalf("sub = %q, want %q", sub, "user-123")
	}
	if email != "user@test.com" {
		t.Fatalf("email = %q, want %q", email, "user@test.com")
	}
	if role != "" {
		t.Fatalf("role = %q, want empty", role)
	}
}

func TestVerifyES256Tampered(t *testing.T) {
	resetJWKS()
	url, key, closeFn := newJWKSServer(t, "k1")
	defer closeFn()

	token := signES256(t, key, "k1", map[string]any{
		"sub":   "user-123",
		"email": "user@test.com",
	})

	// Flip one bit in the payload so the signature no longer matches.
	parts := strings.Split(token, ".")
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	payload[0] ^= 0x01 // corrupt the first byte
	parts[1] = b64u(payload)
	tampered := strings.Join(parts, ".")

	cfg := &config.Config{SupabaseURL: url}
	sub, _, _ := verifySupabaseJWT(cfg, tampered)
	if sub != "" {
		t.Fatalf("tampered token verified with sub=%q; want empty", sub)
	}
}

func TestVerifyHS256Fallback(t *testing.T) {
	resetJWKS()

	secret := "test-secret"
	claims := map[string]any{
		"sub":   "user-456",
		"email": "legacy@test.com",
	}

	claimsBytes, _ := json.Marshal(claims)
	hdrBytes, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})

	signingInput := b64u(hdrBytes) + "." + b64u(claimsBytes)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingInput))
	token := signingInput + "." + b64u(mac.Sum(nil))

	cfg := &config.Config{SupabaseJWTSecret: secret}
	sub, email, _ := verifySupabaseJWT(cfg, token)
	if sub != "user-456" {
		t.Fatalf("sub = %q, want %q", sub, "user-456")
	}
	if email != "legacy@test.com" {
		t.Fatalf("email = %q, want %q", email, "legacy@test.com")
	}
}

func TestVerifyUnknownAlg(t *testing.T) {
	resetJWKS()

	// A well-formed token with an unsupported algorithm must be rejected.
	claimsBytes, _ := json.Marshal(map[string]any{"sub": "user", "email": "x@y.z"})
	hdrBytes, _ := json.Marshal(map[string]string{"alg": "none", "typ": "JWT"})
	token := b64u(hdrBytes) + "." + b64u(claimsBytes) + "." + b64u([]byte("sig"))

	cfg := &config.Config{}
	sub, _, _ := verifySupabaseJWT(cfg, token)
	if sub != "" {
		t.Fatalf("alg=none token verified with sub=%q; want empty", sub)
	}
}

func TestVerifyWrongKid(t *testing.T) {
	resetJWKS()
	url, key, closeFn := newJWKSServer(t, "k1")
	defer closeFn()

	// Token references kid "k2", which the server does not publish.
	token := signES256(t, key, "k2", map[string]any{"sub": "user", "email": "x@y.z"})

	cfg := &config.Config{SupabaseURL: url}
	sub, _, _ := verifySupabaseJWT(cfg, token)
	if sub != "" {
		t.Fatalf("unknown kid token verified with sub=%q; want empty", sub)
	}
}

// TestFetchJWKSSkipsNonEC guards the JSON decoding contract: non-EC (and
// non-P-256) entries are skipped, while a valid P-256 key is still picked up.
func TestFetchJWKSSkipsNonEC(t *testing.T) {
	resetJWKS()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	x := make([]byte, 32)
	y := make([]byte, 32)
	key.PublicKey.X.FillBytes(x)
	key.PublicKey.Y.FillBytes(y)

	doc := jwksJSON{
		Keys: []jwksJSONKey{
			{Kid: "rsa", Kty: "RSA", Crv: "", X: "", Y: ""},
			{Kid: "ec521", Kty: "EC", Crv: "P-521", X: b64u(make([]byte, 66)), Y: b64u(make([]byte, 66))},
			{Kid: "k1", Kty: "EC", Crv: "P-256", X: b64u(x), Y: b64u(y)},
		},
	}
	body, _ := json.Marshal(doc)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	keys, err := fetchJWKS(srv.URL)
	if err != nil {
		t.Fatalf("fetchJWKS error: %v", err)
	}
	// Only the P-256 key survives; the RSA and P-521 entries are skipped.
	if len(keys) != 1 {
		t.Fatalf("expected 1 usable key, got %d", len(keys))
	}
	if _, ok := keys["k1"]; !ok {
		t.Fatalf("expected key with kid %q, found %v", "k1", keys)
	}
}
