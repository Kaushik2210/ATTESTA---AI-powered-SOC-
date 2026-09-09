package ledger

import (
	"crypto/ed25519"
	"testing"
)

func sampleManifest() Manifest {
	seed := int64(42)
	return Manifest{
		InvestigationID:    "inv-1",
		TenantID:           "tenant-a",
		CaseID:             "case-1",
		EpochRoot:          [32]byte{1, 2, 3},
		EpochID:            7,
		ClaimSetHash:       [32]byte{4, 5, 6},
		ClaimIDs:           [][32]byte{{9, 9}, {8, 8}},
		Inference: InferenceMeta{
			Provider:             "fake-model-a",
			ModelID:              "fake-model-a-v1",
			WeightsDigest:        "blake3:deadbeef",
			Seed:                 &seed,
			DecodeParams:         map[string]string{"temperature": "0.0"},
			PromptTemplateHashes: [][32]byte{{1}},
			ToolVersions:         map[string]string{"fetch_evidence": "1"},
		},
		PolicyVersion:       "policy.v1",
		KernelVersion:       "0.0.0-test",
		AttackModelVersion:  "attack.v1",
		VerdictSeverity:     "high",
		VerdictConfidence:   4200,
		VerdictDisposition:  "malicious",
		VerdictHash:         [32]byte{7, 7, 7},
		BudgetConsumed:      BudgetConsumed{ToolCalls: 3, Turns: 2},
		StartedAtNS:         1_000,
		CompletedAtNS:       2_000,
	}
}

func testSigner(t *testing.T) ed25519.PrivateKey {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("generating test key: %v", err)
	}
	return priv
}

func TestManifestHashIsDeterministic(t *testing.T) {
	a, err := ManifestHash(sampleManifest())
	if err != nil {
		t.Fatalf("ManifestHash: %v", err)
	}
	b, err := ManifestHash(sampleManifest())
	if err != nil {
		t.Fatalf("ManifestHash: %v", err)
	}
	if a != b {
		t.Fatalf("ManifestHash not deterministic: %x != %x", a, b)
	}
}

func TestManifestHashChangesWithContent(t *testing.T) {
	a, _ := ManifestHash(sampleManifest())
	changed := sampleManifest()
	changed.VerdictConfidence = 4201
	b, _ := ManifestHash(changed)
	if a == b {
		t.Fatalf("ManifestHash did not change when VerdictConfidence changed")
	}
}

func TestManifestHashChangesWithPrevManifestHash(t *testing.T) {
	// The chain-linking field must itself be load-bearing in the hash —
	// otherwise a reordered or spliced chain would be undetectable.
	a, _ := ManifestHash(sampleManifest())
	linked := sampleManifest()
	linked.PrevManifestHash = [32]byte{0xff}
	b, _ := ManifestHash(linked)
	if a == b {
		t.Fatalf("ManifestHash did not change when PrevManifestHash changed")
	}
}

func TestSealAndVerifyRoundTrips(t *testing.T) {
	signer := testSigner(t)
	sealed, err := SealManifest(sampleManifest(), signer)
	if err != nil {
		t.Fatalf("SealManifest: %v", err)
	}
	ok, err := VerifySealedManifest(sealed)
	if err != nil {
		t.Fatalf("VerifySealedManifest: %v", err)
	}
	if !ok {
		t.Fatalf("freshly sealed manifest failed to verify")
	}
}

func TestVerifyRejectsTamperedField(t *testing.T) {
	signer := testSigner(t)
	sealed, err := SealManifest(sampleManifest(), signer)
	if err != nil {
		t.Fatalf("SealManifest: %v", err)
	}
	sealed.VerdictDisposition = "benign" // tamper after sealing, signature now stale
	ok, err := VerifySealedManifest(sealed)
	if err != nil {
		t.Fatalf("VerifySealedManifest: %v", err)
	}
	if ok {
		t.Fatalf("tampered manifest verified successfully — signature check is not load-bearing")
	}
}

func TestVerifyRejectsWrongSignature(t *testing.T) {
	signer := testSigner(t)
	sealed, err := SealManifest(sampleManifest(), signer)
	if err != nil {
		t.Fatalf("SealManifest: %v", err)
	}
	otherSigner := testSigner(t)
	sealed.PublicKey = otherSigner.Public().(ed25519.PublicKey)
	ok, err := VerifySealedManifest(sealed)
	if err != nil {
		t.Fatalf("VerifySealedManifest: %v", err)
	}
	if ok {
		t.Fatalf("manifest verified against the wrong signer's public key")
	}
}

func TestManifestHashIndependentOfMapIterationOrder(t *testing.T) {
	// DecodeParams and ToolVersions are Go maps, and Go deliberately
	// randomizes map iteration order between runs. Run this enough times
	// in one process that a non-deterministic encoder would be caught.
	m := sampleManifest()
	m.Inference.DecodeParams = map[string]string{"temperature": "0.0", "top_p": "1.0", "seed": "42"}
	m.Inference.ToolVersions = map[string]string{"a": "1", "b": "2", "c": "3", "d": "4"}
	first, err := ManifestHash(m)
	if err != nil {
		t.Fatalf("ManifestHash: %v", err)
	}
	for i := 0; i < 200; i++ {
		h, err := ManifestHash(m)
		if err != nil {
			t.Fatalf("ManifestHash: %v", err)
		}
		if h != first {
			t.Fatalf("ManifestHash varied across repeated calls (map iteration order leaked into the hash)")
		}
	}
}
