package agent

import (
	"encoding/binary"
	"testing"
)

// TestBoundedBuffer_BurstZeroLossInOrder is the Phase 2 gate's backpressure
// requirement: "Agent survives a 10x burst with bounded memory and zero
// loss" (phases/PHASES.md). Pushing is done synchronously (no consumer
// draining concurrently) specifically because Push must never block —
// that's the property under test: 10x capacity worth of events pushed
// with nothing draining must not hang, must not drop anything, and must
// keep the in-memory queue within its bound throughout.
func TestBoundedBuffer_BurstZeroLossInOrder(t *testing.T) {
	const capacity = 50
	const totalEvents = capacity * 10 // a 10x burst

	dir := t.TempDir()
	buf, err := NewBoundedBuffer(capacity, dir)
	if err != nil {
		t.Fatal(err)
	}

	for i := 0; i < totalEvents; i++ {
		ev := make([]byte, 8)
		binary.BigEndian.PutUint64(ev, uint64(i))
		if err := buf.Push(ev); err != nil {
			t.Fatalf("Push(%d): %v", i, err)
		}
		if got := buf.MemLen(); got > capacity {
			t.Fatalf("in-memory queue exceeded its bound after push %d: %d > %d", i, got, capacity)
		}
	}
	if spilled := buf.SpillCount(); spilled == 0 {
		t.Fatal("expected the burst (10x capacity, nothing draining) to exercise the disk-spill path, but nothing spilled")
	}
	buf.Close()

	var got []uint64
	for {
		ev, ok := buf.Next()
		if !ok {
			break
		}
		if len(ev) != 8 {
			t.Fatalf("received a malformed/lost event: %v", ev)
		}
		got = append(got, binary.BigEndian.Uint64(ev))
	}

	if len(got) != totalEvents {
		t.Fatalf("zero-loss violated: pushed %d, received %d", totalEvents, len(got))
	}
	for i, v := range got {
		if v != uint64(i) {
			t.Fatalf("order violated at position %d: got sequence %d, want %d", i, v, i)
		}
	}
}

// TestBoundedBuffer_ConcurrentProducerConsumer exercises the same
// zero-loss/in-order guarantee under real concurrency — a producer
// bursting while a consumer drains at the same time — rather than the
// fully-sequential scenario above.
func TestBoundedBuffer_ConcurrentProducerConsumer(t *testing.T) {
	const capacity = 20
	const totalEvents = capacity * 10

	dir := t.TempDir()
	buf, err := NewBoundedBuffer(capacity, dir)
	if err != nil {
		t.Fatal(err)
	}

	go func() {
		for i := 0; i < totalEvents; i++ {
			ev := make([]byte, 8)
			binary.BigEndian.PutUint64(ev, uint64(i))
			if err := buf.Push(ev); err != nil {
				t.Errorf("Push(%d): %v", i, err)
			}
		}
		buf.Close()
	}()

	var got []uint64
	for {
		ev, ok := buf.Next()
		if !ok {
			break
		}
		got = append(got, binary.BigEndian.Uint64(ev))
	}

	if len(got) != totalEvents {
		t.Fatalf("concurrent: zero-loss violated: pushed %d, received %d", totalEvents, len(got))
	}
	for i, v := range got {
		if v != uint64(i) {
			t.Fatalf("concurrent: order violated at position %d: got sequence %d, want %d", i, v, i)
		}
	}
}

func TestBoundedBuffer_RejectsNonPositiveCapacity(t *testing.T) {
	if _, err := NewBoundedBuffer(0, t.TempDir()); err == nil {
		t.Fatal("expected an error constructing a buffer with zero capacity")
	}
	if _, err := NewBoundedBuffer(-1, t.TempDir()); err == nil {
		t.Fatal("expected an error constructing a buffer with negative capacity")
	}
}

// TestBoundedBuffer_NoSpillUnderCapacityStaysInMemory confirms the buffer
// doesn't spill unnecessarily -- disk is an overflow path, not the
// default.
func TestBoundedBuffer_NoSpillUnderCapacityStaysInMemory(t *testing.T) {
	const capacity = 50
	dir := t.TempDir()
	buf, err := NewBoundedBuffer(capacity, dir)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < capacity/2; i++ {
		if err := buf.Push([]byte{byte(i)}); err != nil {
			t.Fatal(err)
		}
	}
	if spilled := buf.SpillCount(); spilled != 0 {
		t.Fatalf("expected no spilling while under capacity, got %d spilled events", spilled)
	}
}
