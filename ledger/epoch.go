package ledger

import (
	"crypto/ed25519"
	"encoding/binary"

	"lukechampine.com/blake3"
)

// BatchSeal is a sealed batch root — docs/ARCHITECTURE.md §2.3: "Every 10
// seconds (configurable) a batch root is sealed." It commits to an ordered
// list of EvidenceIDs via their Merkle tree.
type BatchSeal struct {
	Root [32]byte
	Tree *MerkleTree
}

// SealBatch commits an ordered list of EvidenceIDs into a batch root.
func SealBatch(ids []EvidenceID) (BatchSeal, error) {
	tree, err := BuildMerkleTree(ids)
	if err != nil {
		return BatchSeal{}, err
	}
	return BatchSeal{Root: tree.Root(), Tree: tree}, nil
}

// EpochSeal is a sealed, signed epoch root — docs/ARCHITECTURE.md §2.3:
// "every hour an epoch root commits all batch roots in that window ...
// signed (Ed25519, per-tenant key) and chained: epoch_n.prev =
// hash(epoch_{n-1})."
type EpochSeal struct {
	EpochID   uint64
	Root      [32]byte // Merkle root over this epoch's batch roots
	Prev      [32]byte // hash of the previous EpochSeal's signed header; zero for epoch 0
	PublicKey ed25519.PublicKey
	Signature []byte
	Tree      *MerkleTree
}

// signedHeader is the exact byte sequence that gets signed and chained —
// fixed layout, no ambiguity about field order or encoding, so
// verification never depends on how a struct happens to serialize.
func signedHeader(epochID uint64, root, prev [32]byte) []byte {
	buf := make([]byte, 8+32+32)
	binary.BigEndian.PutUint64(buf[0:8], epochID)
	copy(buf[8:40], root[:])
	copy(buf[40:72], prev[:])
	return buf
}

// SealEpoch commits an ordered list of batch roots into a signed,
// chained epoch root. prev must be the previous epoch's chain hash (see
// EpochSeal.ChainHash), or the zero value for the first epoch.
func SealEpoch(epochID uint64, batchRoots [][32]byte, prev [32]byte, signer ed25519.PrivateKey) (EpochSeal, error) {
	ids := make([]EvidenceID, len(batchRoots))
	for i, r := range batchRoots {
		ids[i] = EvidenceID(r)
	}
	tree, err := BuildMerkleTree(ids)
	if err != nil {
		return EpochSeal{}, err
	}
	root := tree.Root()
	header := signedHeader(epochID, root, prev)
	sig := ed25519.Sign(signer, header)
	return EpochSeal{
		EpochID:   epochID,
		Root:      root,
		Prev:      prev,
		PublicKey: signer.Public().(ed25519.PublicKey),
		Signature: sig,
		Tree:      tree,
	}, nil
}

// Verify checks the epoch's signature over its own (epochID, root, prev)
// header. It does not check chain continuity against a prior epoch —
// that's ChainHash equality, a separate concern the caller checks across
// consecutive seals.
func (e EpochSeal) Verify() bool {
	header := signedHeader(e.EpochID, e.Root, e.Prev)
	return ed25519.Verify(e.PublicKey, header, e.Signature)
}

// ChainHash is what the NEXT epoch's Prev field must equal — it commits to
// the full signed header AND its signature, so a chain break (reordered,
// dropped, or altered epoch, or even a swapped-in signature over the same
// header) is detectable from the next epoch's Prev value alone, without
// needing the intermediate epoch's full contents.
func (e EpochSeal) ChainHash() [32]byte {
	buf := make([]byte, 0, 8+32+32+len(e.Signature))
	buf = append(buf, signedHeader(e.EpochID, e.Root, e.Prev)...)
	buf = append(buf, e.Signature...)
	return blake3.Sum256(buf)
}
