// Package agent implements the endpoint sensor's OS-agnostic core:
// bounded, backpressure-tolerant buffering between event capture and
// shipping. docs/ARCHITECTURE.md §2.1: "Agent buffers to disk with a
// bounded ring, signs each batch with a per-agent key, and ships over
// mTLS. Backpressure is the agent's problem, never the collector's."
//
// Scope note (see phases/reports/PHASE-02.md): OS-specific kernel-level
// capture — Windows ETW consumer sessions (agent/etw/), Linux eBPF
// (agent/ebpf/), macOS Endpoint Security (agent/es/) — needs a real
// Windows/Linux/macOS host with kernel access to build and test against,
// none of which are available in this environment. This package is the
// part that IS buildable and testable here: whatever a Source produces,
// this buffer is what guarantees bounded memory and zero loss under a
// burst, which is exactly what the Phase 2 gate's backpressure
// requirement tests.
package agent

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// BoundedBuffer is a FIFO queue with a fixed in-memory capacity, backed by
// a disk overflow queue. Push never blocks and never drops an event: once
// the in-memory portion is full, further events spill to disk instead.
// Next drains in overall FIFO order — memory first, then, once spilling,
// the disk backlog, and only once the disk backlog is fully drained does
// Push resume writing directly to memory. Staying committed to disk for
// the whole time between "memory filled up" and "disk backlog fully
// drained" is what keeps the FIFO order correct; alternating between the
// two per-event would reorder events.
type BoundedBuffer struct {
	mu       sync.Mutex
	cond     *sync.Cond
	capacity int
	memQueue [][]byte

	spilling  bool
	spillDir  string
	spillSeq  uint64
	spilled   []string // filenames, oldest first
	spillHits uint64   // cumulative count of events that took the disk path

	closed bool
}

// NewBoundedBuffer creates a buffer with the given in-memory capacity
// (event count, not bytes — matching docs/ARCHITECTURE.md's "bounded
// ring"). spillDir is created if it doesn't exist.
func NewBoundedBuffer(capacity int, spillDir string) (*BoundedBuffer, error) {
	if capacity <= 0 {
		return nil, fmt.Errorf("agent: capacity must be positive, got %d", capacity)
	}
	if err := os.MkdirAll(spillDir, 0o755); err != nil {
		return nil, fmt.Errorf("agent: creating spill directory %s: %w", spillDir, err)
	}
	b := &BoundedBuffer{capacity: capacity, spillDir: spillDir}
	b.cond = sync.NewCond(&b.mu)
	return b, nil
}

// Push enqueues an event. It never blocks and never returns an error due
// to the buffer being full — only a genuine disk I/O failure while
// spilling can fail it, which is the honest failure mode: an agent that
// can't write to its own local disk has a real problem to surface, not
// one to paper over.
func (b *BoundedBuffer) Push(event []byte) error {
	b.mu.Lock()
	if !b.spilling && len(b.memQueue) < b.capacity {
		b.memQueue = append(b.memQueue, event)
		b.mu.Unlock()
		b.cond.Signal()
		return nil
	}
	b.spilling = true
	seq := b.spillSeq
	b.spillSeq++
	b.spillHits++
	b.mu.Unlock()

	path := filepath.Join(b.spillDir, fmt.Sprintf("%020d.evt", seq))
	if err := os.WriteFile(path, event, 0o600); err != nil {
		return fmt.Errorf("agent: spilling event %d to disk: %w", seq, err)
	}

	b.mu.Lock()
	b.spilled = append(b.spilled, path)
	b.mu.Unlock()
	b.cond.Signal()
	return nil
}

// Next blocks until an event is available and returns it. ok is false
// once Close has been called and everything buffered (memory, then any
// disk backlog) has been fully drained.
func (b *BoundedBuffer) Next() (event []byte, ok bool) {
	b.mu.Lock()
	for {
		if len(b.memQueue) > 0 {
			ev := b.memQueue[0]
			b.memQueue = b.memQueue[1:]
			b.mu.Unlock()
			return ev, true
		}
		if len(b.spilled) > 0 {
			path := b.spilled[0]
			b.spilled = b.spilled[1:]
			if len(b.spilled) == 0 {
				b.spilling = false
			}
			b.mu.Unlock()
			data, err := os.ReadFile(path)
			_ = os.Remove(path)
			if err != nil {
				// A read failure here means data is gone from disk in a
				// way this type can't recover — surfacing nil rather
				// than silently skipping keeps "zero loss" an honest,
				// checkable claim: the caller sees a short/nil event
				// instead of an uncounted gap.
				return nil, true
			}
			return data, true
		}
		if b.closed {
			b.mu.Unlock()
			return nil, false
		}
		b.cond.Wait() // atomically unlocks, blocks, re-locks before returning
	}
}

// Close signals that no more events will be pushed. Callers must stop
// calling Push before calling Close — this type has one producer's worth
// of lifecycle, matching how a single agent process owns its own buffer.
func (b *BoundedBuffer) Close() {
	b.mu.Lock()
	b.closed = true
	b.mu.Unlock()
	b.cond.Broadcast()
}

// MemLen reports the current in-memory queue length — always <= capacity
// by construction; exposed so tests can assert the bound directly rather
// than trusting it.
func (b *BoundedBuffer) MemLen() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.memQueue)
}

// SpillCount reports how many events have ever taken the disk-overflow
// path, cumulative for this buffer's lifetime.
func (b *BoundedBuffer) SpillCount() uint64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.spillHits
}
