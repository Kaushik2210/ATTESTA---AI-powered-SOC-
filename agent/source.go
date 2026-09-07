package agent

import "context"

// Source is what an OS-specific collector implements to feed a
// BoundedBuffer. Real implementations — a Windows ETW consumer session
// (agent/etw/), a Linux eBPF tracepoint/kprobe loader (agent/ebpf/), a
// macOS Endpoint Security client (agent/es/) — need a real host with
// kernel access to build and test against, none of which are available in
// this environment; see phases/reports/PHASE-02.md. Defining this
// interface now, against the buffer this phase DOES build and test,
// is what lets those collectors be added later as pure implementations of
// it rather than a redesign.
type Source interface {
	// Name identifies the source for logging and metrics, e.g.
	// "etw:kernel-process" or "ebpf:sched_process_exec".
	Name() string

	// Run reads from the OS-level capture mechanism until ctx is done or
	// an unrecoverable error occurs, pushing each raw captured event into
	// buf. Implementations own retrying/reconnecting to their capture
	// session; Run returning at all means collection has stopped.
	Run(ctx context.Context, buf *BoundedBuffer) error
}
