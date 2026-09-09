package ledger

import (
	"crypto/ed25519"

	"lukechampine.com/blake3"
)

// InferenceMeta records which model/provider produced a claim set —
// docs/ARCHITECTURE.md §2.9's `inference` block. DecodeParams is
// string-keyed/string-valued rather than numeric: decode parameters like
// temperature are inherently fractional, and this package's canonical
// encoding deliberately has no float rule (see cbor.go's doc comment) —
// keeping them as their literal string form sidesteps re-opening that
// question for a field that is descriptive metadata, not something the
// verdict depends on.
type InferenceMeta struct {
	Provider             string
	ModelID              string
	WeightsDigest        string
	Seed                 *int64
	DecodeParams         map[string]string
	PromptTemplateHashes [][32]byte
	ToolVersions         map[string]string
}

// BudgetConsumed is docs/ARCHITECTURE.md §2.9's `budget_consumed` — how
// much of services/investigate's Budget (Phase 6) an investigation used.
type BudgetConsumed struct {
	ToolCalls int64
	Turns     int64
}

// Manifest is docs/ARCHITECTURE.md §2.9's InvestigationManifest, minus the
// two fields (`manifest_hash`, `signature`) that only exist once the
// manifest has been sealed — see SealedManifest.
//
// IndexSnapshotHash is carried as an opaque field and left the zero value
// in this phase: a real full-text/vector index over case state doesn't
// exist yet (no phase before Phase 9's UI needs it), so there is nothing
// honest to hash into it yet. It is part of the struct now so sealing a
// manifest never has to change shape again once the index exists.
type Manifest struct {
	InvestigationID    string
	TenantID           string
	CaseID             string
	EpochRoot          [32]byte
	EpochID            uint64
	IndexSnapshotHash  [32]byte
	ClaimSetHash       [32]byte
	ClaimIDs           [][32]byte
	Inference          InferenceMeta
	PolicyVersion      string
	KernelVersion      string
	AttackModelVersion string
	VerdictSeverity    string
	VerdictConfidence  int64
	VerdictDisposition string
	VerdictHash        [32]byte
	BudgetConsumed     BudgetConsumed
	StartedAtNS        int64
	CompletedAtNS      int64
	// PrevManifestHash chains this manifest to the previous one sealed for
	// the same TenantID — docs/ARCHITECTURE.md §2.9: "hash-chained per
	// tenant." The zero value marks the first manifest in a tenant's
	// chain. Callers own tracking "what was the last hash for this
	// tenant" (see services/adjudicate/attesta_adjudicate/store.py) —
	// this package stays a pure function of its input, the same
	// discipline epoch.go's SealEpoch already applies to its own `prev`
	// parameter.
	PrevManifestHash [32]byte
}

// SealedManifest is a Manifest plus the two fields that exist only once
// it's been canonicalized, hashed, and signed.
type SealedManifest struct {
	Manifest
	ManifestHash [32]byte
	Signature    []byte
	PublicKey    ed25519.PublicKey
}

// canonicalManifestMap builds the map[string]any that EncodeCanonical
// hashes. Field order in this function is irrelevant to the resulting
// bytes — encodeMap sorts by encoded key regardless — but every field is
// listed explicitly and by name specifically so adding a struct field
// without adding it here is a visible diff, not a silent gap in what
// actually gets committed to the hash chain.
func canonicalManifestMap(m Manifest) map[string]any {
	claimIDs := make([]any, len(m.ClaimIDs))
	for i, id := range m.ClaimIDs {
		claimIDs[i] = id[:]
	}
	promptHashes := make([]any, len(m.Inference.PromptTemplateHashes))
	for i, h := range m.Inference.PromptTemplateHashes {
		promptHashes[i] = h[:]
	}
	decodeParams := make(map[string]any, len(m.Inference.DecodeParams))
	for k, v := range m.Inference.DecodeParams {
		decodeParams[k] = v
	}
	toolVersions := make(map[string]any, len(m.Inference.ToolVersions))
	for k, v := range m.Inference.ToolVersions {
		toolVersions[k] = v
	}
	var seed any
	if m.Inference.Seed != nil {
		seed = *m.Inference.Seed
	}

	return map[string]any{
		"investigation_id":    m.InvestigationID,
		"tenant_id":           m.TenantID,
		"case_id":             m.CaseID,
		"epoch_root":          m.EpochRoot[:],
		"epoch_id":            uint64(m.EpochID),
		"index_snapshot_hash": m.IndexSnapshotHash[:],
		"claim_set_hash":      m.ClaimSetHash[:],
		"claim_ids":           claimIDs,
		"inference": map[string]any{
			"provider":               m.Inference.Provider,
			"model_id":               m.Inference.ModelID,
			"weights_digest":         m.Inference.WeightsDigest,
			"seed":                   seed,
			"decode_params":          decodeParams,
			"prompt_template_hashes": promptHashes,
			"tool_versions":          toolVersions,
		},
		"policy_version":       m.PolicyVersion,
		"kernel_version":       m.KernelVersion,
		"attack_model_version": m.AttackModelVersion,
		"verdict_severity":     m.VerdictSeverity,
		"verdict_confidence":   m.VerdictConfidence,
		"verdict_disposition":  m.VerdictDisposition,
		"verdict_hash":         m.VerdictHash[:],
		"budget_consumed": map[string]any{
			"tool_calls": m.BudgetConsumed.ToolCalls,
			"turns":      m.BudgetConsumed.Turns,
		},
		"started_at_ns":      m.StartedAtNS,
		"completed_at_ns":    m.CompletedAtNS,
		"prev_manifest_hash": m.PrevManifestHash[:],
	}
}

// ManifestHash computes BLAKE3(canonical_cbor(manifest)) — the content
// address a SealedManifest commits to, and the value the next manifest in
// the same tenant's chain sets as its own PrevManifestHash.
func ManifestHash(m Manifest) ([32]byte, error) {
	canonical, err := EncodeCanonical(canonicalManifestMap(m))
	if err != nil {
		return [32]byte{}, err
	}
	return blake3.Sum256(canonical), nil
}

// SealManifest computes the manifest's hash and signs it with the given
// per-tenant Ed25519 key — the same signing primitive epoch.go's
// SealEpoch already uses, applied here to a manifest instead of an epoch
// header. A pure function: it never consults or mutates any store, so the
// caller supplies PrevManifestHash on m already set correctly (see the
// Manifest.PrevManifestHash doc comment).
func SealManifest(m Manifest, signer ed25519.PrivateKey) (SealedManifest, error) {
	hash, err := ManifestHash(m)
	if err != nil {
		return SealedManifest{}, err
	}
	sig := ed25519.Sign(signer, hash[:])
	return SealedManifest{
		Manifest:     m,
		ManifestHash: hash,
		Signature:    sig,
		PublicKey:    signer.Public().(ed25519.PublicKey),
	}, nil
}

// VerifySealedManifest recomputes the manifest's hash from its own fields
// and checks both that it matches the claimed ManifestHash (nothing was
// tampered with after sealing) and that the signature verifies against
// the embedded public key. This is the exact check a third party runs
// against an exported bundle with no access to any of ATTESTA's own
// systems — docs/ARCHITECTURE.md §2.9's "court-defensible" property.
func VerifySealedManifest(sm SealedManifest) (bool, error) {
	recomputed, err := ManifestHash(sm.Manifest)
	if err != nil {
		return false, err
	}
	if recomputed != sm.ManifestHash {
		return false, nil
	}
	return ed25519.Verify(sm.PublicKey, sm.ManifestHash[:], sm.Signature), nil
}
