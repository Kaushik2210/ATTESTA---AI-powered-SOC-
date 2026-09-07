package ledger

import (
	"crypto/ed25519"
	"crypto/rand"
	"testing"
)

func newTestSigner(t *testing.T) ed25519.PrivateKey {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	return priv
}

func TestSealBatch_RootMatchesUnderlyingTree(t *testing.T) {
	ids := idsN(5)
	seal, err := SealBatch(ids)
	if err != nil {
		t.Fatal(err)
	}
	if seal.Root != seal.Tree.Root() {
		t.Fatal("BatchSeal.Root does not match its own tree's root")
	}
}

func TestSealEpoch_SignatureVerifies(t *testing.T) {
	signer := newTestSigner(t)
	batchRoots := [][32]byte{
		mustSealBatch(t, idsN(3)).Root,
		mustSealBatch(t, idsN(4)).Root,
	}
	var zero [32]byte
	epoch, err := SealEpoch(0, batchRoots, zero, signer)
	if err != nil {
		t.Fatal(err)
	}
	if !epoch.Verify() {
		t.Fatal("freshly sealed epoch failed to verify its own signature")
	}
}

func TestSealEpoch_TamperedRootFailsVerification(t *testing.T) {
	signer := newTestSigner(t)
	batchRoots := [][32]byte{mustSealBatch(t, idsN(3)).Root}
	var zero [32]byte
	epoch, err := SealEpoch(0, batchRoots, zero, signer)
	if err != nil {
		t.Fatal(err)
	}
	epoch.Root[0] ^= 0xff
	if epoch.Verify() {
		t.Fatal("tampered epoch root unexpectedly verified")
	}
}

func TestSealEpoch_WrongPublicKeyFailsVerification(t *testing.T) {
	signer := newTestSigner(t)
	other := newTestSigner(t)
	batchRoots := [][32]byte{mustSealBatch(t, idsN(2)).Root}
	var zero [32]byte
	epoch, err := SealEpoch(0, batchRoots, zero, signer)
	if err != nil {
		t.Fatal(err)
	}
	epoch.PublicKey = other.Public().(ed25519.PublicKey)
	if epoch.Verify() {
		t.Fatal("epoch verified against the wrong public key")
	}
}

// TestEpochChain_PrevMustMatchPriorChainHash proves the chaining property
// ARCHITECTURE.md §2.3 describes: epoch_n.prev = hash(epoch_{n-1}). A
// reordered or substituted epoch breaks the chain in a way that's
// detectable from the NEXT epoch's Prev field alone.
func TestEpochChain_PrevMustMatchPriorChainHash(t *testing.T) {
	signer := newTestSigner(t)
	var zero [32]byte

	epoch0, err := SealEpoch(0, [][32]byte{mustSealBatch(t, idsN(2)).Root}, zero, signer)
	if err != nil {
		t.Fatal(err)
	}
	epoch1, err := SealEpoch(1, [][32]byte{mustSealBatch(t, idsN(3)).Root}, epoch0.ChainHash(), signer)
	if err != nil {
		t.Fatal(err)
	}

	if epoch1.Prev != epoch0.ChainHash() {
		t.Fatal("epoch1.Prev does not match epoch0's chain hash")
	}

	// Simulate a dropped/substituted epoch: sealing epoch1 against the
	// WRONG previous chain hash should not equal a validly-chained one.
	wrongPrev := epoch1.ChainHash() // any value that isn't epoch0.ChainHash()
	forged, err := SealEpoch(1, [][32]byte{mustSealBatch(t, idsN(3)).Root}, wrongPrev, signer)
	if err != nil {
		t.Fatal(err)
	}
	if forged.Prev == epoch0.ChainHash() {
		t.Fatal("forged epoch's Prev accidentally matched the real chain — test setup is broken")
	}
	// The forged epoch's own signature still verifies (it IS validly
	// signed by the same key) -- signature validity and chain continuity
	// are separate checks, and callers must perform both.
	if !forged.Verify() {
		t.Fatal("forged epoch's self-signature should still verify — signature validity alone doesn't prove chain continuity")
	}
}

func mustSealBatch(t *testing.T, ids []EvidenceID) BatchSeal {
	t.Helper()
	seal, err := SealBatch(ids)
	if err != nil {
		t.Fatal(err)
	}
	return seal
}
