// manifest_cli is a JSON bridge to the ledger package's manifest sealing
// primitives (ledger/manifest.go) — the Go-side counterpart to
// kernel/src/bin/adjudicate_cli.rs. services/adjudicate/ (Python, Phase 7)
// reaches canonical CBOR encoding, BLAKE3 hashing, and Ed25519 signing the
// same way services/investigate/ reaches the kernel: a subprocess, JSON in
// on stdin, JSON out on stdout, never an FFI binding. Three operations,
// selected by the top-level "op" field:
//
//	"seal"       — canonicalize + hash + sign a manifest
//	"verify"     — recompute a manifest's hash and check hash + signature
//	"canon_hash" — canonicalize + hash an arbitrary JSON value (used for
//	               InvestigationManifest.claim_set_hash, which commits to
//	               the submitted claim set independently of the kernel's
//	               own per-claim claim_id())
//
// Exit code 0 + a result object means success; exit code 2 + an
// {"error": "..."} object means the input was malformed.
package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/Kaushik2210/attesta/ledger"
)

type requestEnvelope struct {
	Op string `json:"op"`
}

type manifestJSON struct {
	InvestigationID    string          `json:"investigation_id"`
	TenantID           string          `json:"tenant_id"`
	CaseID             string          `json:"case_id"`
	EpochRoot          string          `json:"epoch_root"`
	EpochID            uint64          `json:"epoch_id"`
	IndexSnapshotHash  string          `json:"index_snapshot_hash"`
	ClaimSetHash       string          `json:"claim_set_hash"`
	ClaimIDs           []string        `json:"claim_ids"`
	Inference          inferenceJSON   `json:"inference"`
	PolicyVersion      string          `json:"policy_version"`
	KernelVersion      string          `json:"kernel_version"`
	AttackModelVersion string          `json:"attack_model_version"`
	VerdictSeverity    string          `json:"verdict_severity"`
	VerdictConfidence  int64           `json:"verdict_confidence"`
	VerdictDisposition string          `json:"verdict_disposition"`
	VerdictHash        string          `json:"verdict_hash"`
	BudgetConsumed     budgetJSON      `json:"budget_consumed"`
	StartedAtNS        int64           `json:"started_at_ns"`
	CompletedAtNS      int64           `json:"completed_at_ns"`
	PrevManifestHash   string          `json:"prev_manifest_hash"`
}

type inferenceJSON struct {
	Provider             string            `json:"provider"`
	ModelID              string            `json:"model_id"`
	WeightsDigest        string            `json:"weights_digest"`
	Seed                 *int64            `json:"seed"`
	DecodeParams         map[string]string `json:"decode_params"`
	PromptTemplateHashes []string          `json:"prompt_template_hashes"`
	ToolVersions         map[string]string `json:"tool_versions"`
}

type budgetJSON struct {
	ToolCalls int64 `json:"tool_calls"`
	Turns     int64 `json:"turns"`
}

type sealRequest struct {
	Op             string       `json:"op"`
	SigningKeySeed string       `json:"signing_key_seed"`
	Manifest       manifestJSON `json:"manifest"`
}

type verifyRequest struct {
	Op           string       `json:"op"`
	Manifest     manifestJSON `json:"manifest"`
	ManifestHash string       `json:"manifest_hash"`
	Signature    string       `json:"signature"`
	PublicKey    string       `json:"public_key"`
}

type canonHashRequest struct {
	Op    string `json:"op"`
	Value any    `json:"value"`
}

func main() {
	input, err := io.ReadAll(os.Stdin)
	if err != nil {
		fail(fmt.Sprintf("reading stdin: %v", err))
	}

	var env requestEnvelope
	if err := json.Unmarshal(input, &env); err != nil {
		fail(fmt.Sprintf("parsing input JSON: %v", err))
	}

	switch env.Op {
	case "seal":
		runSeal(input)
	case "verify":
		runVerify(input)
	case "canon_hash":
		runCanonHash(input)
	default:
		fail(fmt.Sprintf("unknown op %q (want seal, verify, or canon_hash)", env.Op))
	}
}

func runSeal(input []byte) {
	var req sealRequest
	if err := json.Unmarshal(input, &req); err != nil {
		fail(fmt.Sprintf("parsing seal request: %v", err))
	}
	seed, err := decodeHex32(req.SigningKeySeed, "signing_key_seed")
	if err != nil {
		fail(err.Error())
	}
	signer := ed25519.NewKeyFromSeed(seed[:])

	m, err := buildManifest(req.Manifest)
	if err != nil {
		fail(err.Error())
	}

	sealed, err := ledger.SealManifest(m, signer)
	if err != nil {
		fail(fmt.Sprintf("sealing manifest: %v", err))
	}

	emit(map[string]any{
		"manifest_hash": hex.EncodeToString(sealed.ManifestHash[:]),
		"signature":     hex.EncodeToString(sealed.Signature),
		"public_key":    hex.EncodeToString(sealed.PublicKey),
	})
}

func runVerify(input []byte) {
	var req verifyRequest
	if err := json.Unmarshal(input, &req); err != nil {
		fail(fmt.Sprintf("parsing verify request: %v", err))
	}
	m, err := buildManifest(req.Manifest)
	if err != nil {
		fail(err.Error())
	}
	manifestHash, err := decodeHex32(req.ManifestHash, "manifest_hash")
	if err != nil {
		fail(err.Error())
	}
	signature, err := hex.DecodeString(req.Signature)
	if err != nil {
		fail(fmt.Sprintf("decoding signature: %v", err))
	}
	publicKey, err := hex.DecodeString(req.PublicKey)
	if err != nil {
		fail(fmt.Sprintf("decoding public_key: %v", err))
	}

	sealed := ledger.SealedManifest{
		Manifest:     m,
		ManifestHash: manifestHash,
		Signature:    signature,
		PublicKey:    publicKey,
	}
	valid, err := ledger.VerifySealedManifest(sealed)
	if err != nil {
		fail(fmt.Sprintf("verifying manifest: %v", err))
	}
	emit(map[string]any{"valid": valid})
}

func runCanonHash(input []byte) {
	var req canonHashRequest
	dec := json.NewDecoder(bytes.NewReader(input))
	dec.UseNumber()
	if err := dec.Decode(&req); err != nil {
		fail(fmt.Sprintf("parsing canon_hash request: %v", err))
	}
	canonical, err := canonicalize(req.Value)
	if err != nil {
		fail(fmt.Sprintf("canonicalizing value: %v", err))
	}
	encoded, err := ledger.EncodeCanonical(canonical)
	if err != nil {
		fail(fmt.Sprintf("encoding value: %v", err))
	}
	hash := ledger.HashEvidence(encoded)
	emit(map[string]any{"hash": hex.EncodeToString(hash[:])})
}

func buildManifest(mj manifestJSON) (ledger.Manifest, error) {
	epochRoot, err := decodeHex32(mj.EpochRoot, "epoch_root")
	if err != nil {
		return ledger.Manifest{}, err
	}
	indexSnapshotHash, err := decodeHex32(mj.IndexSnapshotHash, "index_snapshot_hash")
	if err != nil {
		return ledger.Manifest{}, err
	}
	claimSetHash, err := decodeHex32(mj.ClaimSetHash, "claim_set_hash")
	if err != nil {
		return ledger.Manifest{}, err
	}
	verdictHash, err := decodeHex32(mj.VerdictHash, "verdict_hash")
	if err != nil {
		return ledger.Manifest{}, err
	}
	prevManifestHash, err := decodeHex32(mj.PrevManifestHash, "prev_manifest_hash")
	if err != nil {
		return ledger.Manifest{}, err
	}

	claimIDs := make([][32]byte, len(mj.ClaimIDs))
	for i, s := range mj.ClaimIDs {
		id, err := decodeHex32(s, fmt.Sprintf("claim_ids[%d]", i))
		if err != nil {
			return ledger.Manifest{}, err
		}
		claimIDs[i] = id
	}

	promptHashes := make([][32]byte, len(mj.Inference.PromptTemplateHashes))
	for i, s := range mj.Inference.PromptTemplateHashes {
		h, err := decodeHex32(s, fmt.Sprintf("inference.prompt_template_hashes[%d]", i))
		if err != nil {
			return ledger.Manifest{}, err
		}
		promptHashes[i] = h
	}

	return ledger.Manifest{
		InvestigationID:    mj.InvestigationID,
		TenantID:           mj.TenantID,
		CaseID:             mj.CaseID,
		EpochRoot:          epochRoot,
		EpochID:            mj.EpochID,
		IndexSnapshotHash:  indexSnapshotHash,
		ClaimSetHash:       claimSetHash,
		ClaimIDs:           claimIDs,
		Inference: ledger.InferenceMeta{
			Provider:             mj.Inference.Provider,
			ModelID:              mj.Inference.ModelID,
			WeightsDigest:        mj.Inference.WeightsDigest,
			Seed:                 mj.Inference.Seed,
			DecodeParams:         mj.Inference.DecodeParams,
			PromptTemplateHashes: promptHashes,
			ToolVersions:         mj.Inference.ToolVersions,
		},
		PolicyVersion:      mj.PolicyVersion,
		KernelVersion:      mj.KernelVersion,
		AttackModelVersion: mj.AttackModelVersion,
		VerdictSeverity:    mj.VerdictSeverity,
		VerdictConfidence:  mj.VerdictConfidence,
		VerdictDisposition: mj.VerdictDisposition,
		VerdictHash:        verdictHash,
		BudgetConsumed: ledger.BudgetConsumed{
			ToolCalls: mj.BudgetConsumed.ToolCalls,
			Turns:     mj.BudgetConsumed.Turns,
		},
		StartedAtNS:      mj.StartedAtNS,
		CompletedAtNS:    mj.CompletedAtNS,
		PrevManifestHash: prevManifestHash,
	}, nil
}

// canonicalize converts json.Decoder(UseNumber)-produced values
// (map[string]any / []any / json.Number / string / bool / nil) into the
// exact types ledger.EncodeCanonical accepts (map[string]any / []any /
// int64 / string / bool / nil) — rejecting any number with a fractional
// part or decimal exponent, since EncodeCanonical deliberately has no
// float rule (see ledger/cbor.go's doc comment) and this bridge must not
// silently truncate one into an integer.
func canonicalize(v any) (any, error) {
	switch t := v.(type) {
	case nil, bool, string:
		return t, nil
	case json.Number:
		i, err := t.Int64()
		if err != nil {
			return nil, fmt.Errorf("canon_hash: non-integer number %q is not supported (the kernel/ledger canonical encoding has no float rule by design)", t.String())
		}
		return i, nil
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			c, err := canonicalize(val)
			if err != nil {
				return nil, err
			}
			out[k] = c
		}
		return out, nil
	case []any:
		out := make([]any, len(t))
		for i, val := range t {
			c, err := canonicalize(val)
			if err != nil {
				return nil, err
			}
			out[i] = c
		}
		return out, nil
	default:
		return nil, fmt.Errorf("canon_hash: unsupported JSON value type %T", v)
	}
}

func decodeHex32(s string, field string) ([32]byte, error) {
	var out [32]byte
	if s == "" {
		return out, nil // zero value — the documented "unset" sentinel (e.g. genesis prev_manifest_hash)
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		return out, fmt.Errorf("decoding %s: %v", field, err)
	}
	if len(b) != 32 {
		return out, fmt.Errorf("%s must be 32 bytes (64 hex chars), got %d bytes", field, len(b))
	}
	copy(out[:], b)
	return out, nil
}

func emit(v any) {
	if err := json.NewEncoder(os.Stdout).Encode(v); err != nil {
		fmt.Fprintf(os.Stderr, "manifest_cli: writing output: %v\n", err)
		os.Exit(2)
	}
}

func fail(msg string) {
	_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"error": msg})
	os.Exit(2)
}
