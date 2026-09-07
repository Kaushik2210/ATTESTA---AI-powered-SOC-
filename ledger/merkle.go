// Package ledger implements the deterministic, content-addressed evidence
// pipeline described in docs/ARCHITECTURE.md §2.2-2.3: canonical CBOR
// encoding, BLAKE3 content addressing, Merkle batch/epoch sealing, and
// inclusion-proof generation/verification.
package ledger

import "lukechampine.com/blake3"

// Domain-separation prefixes for the three kinds of node this package ever
// hashes. Using distinct prefixes for leaves, internal nodes, and padding
// means no hash collision between node kinds is possible even if an
// attacker fully controls the input bytes — the same defense RFC 6962
// (Certificate Transparency) uses to prevent tree-structure forgery
// attacks. Padding gets its own domain (rather than duplicating the last
// real leaf, the classic Bitcoin-style mistake) so a padded tree can never
// be confused with a differently-shaped real one.
const (
	domainLeaf     = 0x00
	domainInternal = 0x01
	domainPad      = 0x02
)

func leafHash(id EvidenceID) [32]byte {
	buf := make([]byte, 0, 1+len(id))
	buf = append(buf, domainLeaf)
	buf = append(buf, id[:]...)
	return blake3.Sum256(buf)
}

func internalHash(left, right [32]byte) [32]byte {
	buf := make([]byte, 0, 1+32+32)
	buf = append(buf, domainInternal)
	buf = append(buf, left[:]...)
	buf = append(buf, right[:]...)
	return blake3.Sum256(buf)
}

func padHash(index uint64) [32]byte {
	buf := make([]byte, 9)
	buf[0] = domainPad
	for i := 0; i < 8; i++ {
		buf[1+i] = byte(index >> (56 - 8*i))
	}
	return blake3.Sum256(buf)
}

// nextPowerOfTwo returns the smallest power of two >= n (n >= 1).
func nextPowerOfTwo(n int) int {
	p := 1
	for p < n {
		p *= 2
	}
	return p
}

// MerkleTree is a complete (power-of-two, padding-extended) binary hash
// tree over a fixed, ordered list of EvidenceIDs. It is immutable once
// built: sealing a batch or epoch means building one of these and keeping
// its root, never mutating it afterward (invariant I3, append-only).
type MerkleTree struct {
	leafCount int          // number of REAL leaves (excludes padding)
	levels    [][][32]byte // levels[0] = padded leaf hashes, levels[len-1] = [root]
}

// BuildMerkleTree seals an ordered list of EvidenceIDs into a tree. An
// empty list is rejected — an empty batch/epoch is a caller bug, not a
// tree with a well-defined root.
func BuildMerkleTree(ids []EvidenceID) (*MerkleTree, error) {
	if len(ids) == 0 {
		return nil, errEmptyLeafSet
	}
	n := nextPowerOfTwo(len(ids))
	level := make([][32]byte, n)
	for i, id := range ids {
		level[i] = leafHash(id)
	}
	for i := len(ids); i < n; i++ {
		level[i] = padHash(uint64(i))
	}

	levels := [][][32]byte{level}
	for len(level) > 1 {
		next := make([][32]byte, len(level)/2)
		for i := range next {
			next[i] = internalHash(level[2*i], level[2*i+1])
		}
		levels = append(levels, next)
		level = next
	}

	return &MerkleTree{leafCount: len(ids), levels: levels}, nil
}

// Root returns the tree's root hash — the batch root or epoch root that
// gets signed and chained (docs/ARCHITECTURE.md §2.3).
func (t *MerkleTree) Root() [32]byte {
	top := t.levels[len(t.levels)-1]
	return top[0]
}

// ProofStep is one sibling on the path from a leaf to the root.
type ProofStep struct {
	Hash   [32]byte
	IsLeft bool // true if Hash is the LEFT sibling of the current node
}

// InclusionProof proves that a specific EvidenceID was included in a
// specific sealed tree, without needing the rest of the tree.
type InclusionProof struct {
	LeafIndex int
	Steps     []ProofStep
}

// Prove builds an inclusion proof for the leaf at index i (0-based, in the
// original, unpadded order passed to BuildMerkleTree).
func (t *MerkleTree) Prove(i int) (InclusionProof, error) {
	if i < 0 || i >= t.leafCount {
		return InclusionProof{}, errLeafIndexOutOfRange
	}
	steps := make([]ProofStep, 0, len(t.levels)-1)
	idx := i
	for level := 0; level < len(t.levels)-1; level++ {
		nodes := t.levels[level]
		var sib [32]byte
		var isLeft bool
		if idx%2 == 0 {
			sib = nodes[idx+1]
			isLeft = false
		} else {
			sib = nodes[idx-1]
			isLeft = true
		}
		steps = append(steps, ProofStep{Hash: sib, IsLeft: isLeft})
		idx /= 2
	}
	return InclusionProof{LeafIndex: i, Steps: steps}, nil
}

// VerifyInclusion recomputes the root from a claimed EvidenceID and its
// proof, and reports whether it matches the given root. This is exactly
// the computation the browser repeats client-side in the Verdict Ledger's
// "verify inclusion proof" action (docs/UI-SPEC.md) — it depends only on
// the EvidenceID (a hash), never on the underlying payload, which is what
// makes proof verification redaction-tolerant: a redacted node's payload
// can be gone from the Store while its hash, and therefore every proof
// through it, remains fully verifiable.
func VerifyInclusion(id EvidenceID, proof InclusionProof, root [32]byte) bool {
	h := leafHash(id)
	for _, step := range proof.Steps {
		if step.IsLeft {
			h = internalHash(step.Hash, h)
		} else {
			h = internalHash(h, step.Hash)
		}
	}
	return h == root
}
