// Supabase ES256 JWT verification via the project's JWKS endpoint.
//
// Supabase now issues access tokens signed with ES256 (ECDSA P-256) instead of
// the legacy HS256 HMAC secret. The public key to verify those signatures is
// published at <SUPABASE_URL>/auth/v1/.well-known/jwks.json. This file fetches
// and caches that key set and verifies ES256 signatures using only the standard
// library (crypto/ecdsa, crypto/sha256, encoding/json, net/http).
package middleware

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"
)

// jwksCache holds the fetched JSON Web Key Set and the time it was retrieved so
// stale copies can be refreshed. It is protected by a mutex because multiple
// requests may hit the first-fetch path concurrently.
type jwksCache struct {
	mu        sync.Mutex
	keys      map[string]*ecdsa.PublicKey
	fetchedAt time.Time
}

// supabaseJWKS is the package-level cache of public keys. Tests reset it by
// assigning a fresh &jwksCache{} before exercising the fetch/verify paths.
var supabaseJWKS = &jwksCache{}

// jwksTTL is how long a fetched key set is considered fresh before a re-fetch.
const jwksTTL = 10 * time.Minute

// jwksJSONKey is one public key entry in the Supabase JWKS response. We only
// read the fields needed for ES256: the key id, the curve, and the x/y
// coordinates of the P-256 point.
type jwksJSONKey struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

// jwksJSON is the top-level JWKS document shape.
type jwksJSON struct {
	Keys []jwksJSONKey `json:"keys"`
}

// resolveJWKS returns the cached key set, re-fetching from the JWKS endpoint
// when the cache is empty or stale. A fetch error leaves any existing keys in
// place so a transient network problem does not lock everyone out.
func resolveJWKS(supabaseURL string) (map[string]*ecdsa.PublicKey, error) {
	supabaseJWKS.mu.Lock()
	defer supabaseJWKS.mu.Unlock()

	if supabaseJWKS.keys != nil && time.Since(supabaseJWKS.fetchedAt) < jwksTTL {
		return supabaseJWKS.keys, nil
	}

	keys, err := fetchJWKS(supabaseURL)
	if err != nil {
		if supabaseJWKS.keys != nil {
			// Keep serving the stale set rather than failing hard.
			return supabaseJWKS.keys, nil
		}
		return nil, err
	}

	supabaseJWKS.keys = keys
	supabaseJWKS.fetchedAt = time.Now()
	return keys, nil
}

// fetchJWKS downloads and parses the JWKS document, mapping each ES256 P-256
// key's kid to a parsed *ecdsa.PublicKey.
func fetchJWKS(supabaseURL string) (map[string]*ecdsa.PublicKey, error) {
	url := fmt.Sprintf("%s/auth/v1/.well-known/jwks.json", supabaseURL)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("jwks: unexpected status %d", resp.StatusCode)
	}

	var doc jwksJSON
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return nil, err
	}

	keys := make(map[string]*ecdsa.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		// Only ES256 (P-256) keys are relevant for access-token verification.
		if k.Kty != "EC" || k.Crv != "P-256" {
			continue
		}
		xBytes, err := base64.RawURLEncoding.DecodeString(k.X)
		if err != nil {
			continue
		}
		yBytes, err := base64.RawURLEncoding.DecodeString(k.Y)
		if err != nil {
			continue
		}
		if len(xBytes) != 32 || len(yBytes) != 32 {
			continue // P-256 coordinates are 32 bytes each.
		}
		pub := &ecdsa.PublicKey{
			Curve: elliptic.P256(),
			X:     new(big.Int).SetBytes(xBytes),
			Y:     new(big.Int).SetBytes(yBytes),
		}
		keys[k.Kid] = pub
	}
	if len(keys) == 0 && len(doc.Keys) > 0 {
		return nil, fmt.Errorf("jwks: no usable ES256 P-256 keys found")
	}
	return keys, nil
}

// verifyECDSA checks an ES256 signature. A JWT's ES256 signature is the raw
// 64-byte concatenation R||S (32 bytes each, big-endian), not ASN.1/DER. The
// input is the SHA-256 digest of the signed portion ("header.payload").
func verifyECDSA(pub *ecdsa.PublicKey, hashed, sig []byte) bool {
	if len(sig) != 64 {
		return false
	}
	r := new(big.Int).SetBytes(sig[:32])
	s := new(big.Int).SetBytes(sig[32:])
	return ecdsa.Verify(pub, hashed, r, s)
}

// sha256Sum returns the SHA-256 digest of data as a fresh slice.
func sha256Sum(data []byte) []byte {
	sum := sha256.Sum256(data)
	return sum[:]
}
