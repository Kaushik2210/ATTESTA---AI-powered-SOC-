// merkle_cli is a JSON bridge to ledger.BuildMerkleTree/Prove/VerifyInclusion
// — the Go-side counterpart used by services/adjudicate/'s export-bundle
// path (Phase 7) to produce and independently re-verify evidence inclusion
// proofs, the same way manifest_cli bridges manifest sealing. Two
// operations, selected by the top-level "op" field:
//
//	"prove"  — build an inclusion proof for one evidence id within an
//	           ordered batch, returning the proof and the batch's root
//	"verify" — recompute the root from a claimed evidence id and proof,
//	           and report whether it matches a given root — exactly the
//	           check a third party runs against an exported bundle with
//	           no access to the batch's other members
//
// Exit code 0 + a result object means success; exit code 2 + an
// {"error": "..."} object means the input was malformed.
package main

import (
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

type proveRequest struct {
	Op          string   `json:"op"`
	EvidenceIDs []string `json:"evidence_ids"` // ordered batch, as originally sealed
	LeafIndex   int      `json:"leaf_index"`   // which one to prove inclusion for
}

type proofStepJSON struct {
	Hash   string `json:"hash"`
	IsLeft bool   `json:"is_left"`
}

type verifyRequest struct {
	Op         string          `json:"op"`
	EvidenceID string          `json:"evidence_id"`
	LeafIndex  int             `json:"leaf_index"`
	Steps      []proofStepJSON `json:"steps"`
	Root       string          `json:"root"`
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
	case "prove":
		runProve(input)
	case "verify":
		runVerify(input)
	default:
		fail(fmt.Sprintf("unknown op %q (want prove or verify)", env.Op))
	}
}

func runProve(input []byte) {
	var req proveRequest
	if err := json.Unmarshal(input, &req); err != nil {
		fail(fmt.Sprintf("parsing prove request: %v", err))
	}
	if len(req.EvidenceIDs) == 0 {
		fail("evidence_ids must be non-empty")
	}

	ids := make([]ledger.EvidenceID, len(req.EvidenceIDs))
	for i, s := range req.EvidenceIDs {
		id, err := decodeEvidenceID(s)
		if err != nil {
			fail(fmt.Sprintf("evidence_ids[%d]: %v", i, err))
		}
		ids[i] = id
	}

	tree, err := ledger.BuildMerkleTree(ids)
	if err != nil {
		fail(fmt.Sprintf("building tree: %v", err))
	}
	proof, err := tree.Prove(req.LeafIndex)
	if err != nil {
		fail(fmt.Sprintf("proving leaf %d: %v", req.LeafIndex, err))
	}

	steps := make([]proofStepJSON, len(proof.Steps))
	for i, s := range proof.Steps {
		steps[i] = proofStepJSON{Hash: hex.EncodeToString(s.Hash[:]), IsLeft: s.IsLeft}
	}
	root := tree.Root()

	emit(map[string]any{
		"leaf_index": proof.LeafIndex,
		"steps":      steps,
		"root":       hex.EncodeToString(root[:]),
	})
}

func runVerify(input []byte) {
	var req verifyRequest
	if err := json.Unmarshal(input, &req); err != nil {
		fail(fmt.Sprintf("parsing verify request: %v", err))
	}
	id, err := decodeEvidenceID(req.EvidenceID)
	if err != nil {
		fail(fmt.Sprintf("evidence_id: %v", err))
	}
	var root [32]byte
	rootBytes, err := hex.DecodeString(req.Root)
	if err != nil || len(rootBytes) != 32 {
		fail("root must be 32 bytes (64 hex chars)")
	}
	copy(root[:], rootBytes)

	steps := make([]ledger.ProofStep, len(req.Steps))
	for i, s := range req.Steps {
		var h [32]byte
		b, err := hex.DecodeString(s.Hash)
		if err != nil || len(b) != 32 {
			fail(fmt.Sprintf("steps[%d].hash must be 32 bytes (64 hex chars)", i))
		}
		copy(h[:], b)
		steps[i] = ledger.ProofStep{Hash: h, IsLeft: s.IsLeft}
	}

	proof := ledger.InclusionProof{LeafIndex: req.LeafIndex, Steps: steps}
	valid := ledger.VerifyInclusion(id, proof, root)
	emit(map[string]any{"valid": valid})
}

func decodeEvidenceID(s string) (ledger.EvidenceID, error) {
	var id ledger.EvidenceID
	// Accept either the raw 64-hex-char form or the "blake3:<hex>"
	// display form (EvidenceID.String()) — export bundles carry the
	// latter since that's what the rest of the product renders.
	hexPart := s
	if len(s) > 7 && s[:7] == "blake3:" {
		hexPart = s[7:]
	}
	b, err := hex.DecodeString(hexPart)
	if err != nil {
		return id, err
	}
	if len(b) != 32 {
		return id, fmt.Errorf("must be 32 bytes (64 hex chars), got %d bytes", len(b))
	}
	copy(id[:], b)
	return id, nil
}

func emit(v any) {
	if err := json.NewEncoder(os.Stdout).Encode(v); err != nil {
		fmt.Fprintf(os.Stderr, "merkle_cli: writing output: %v\n", err)
		os.Exit(2)
	}
}

func fail(msg string) {
	_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"error": msg})
	os.Exit(2)
}
