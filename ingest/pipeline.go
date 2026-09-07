package ingest

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/Kaushik2210/attesta/ledger"
)

// ReplayCorpus reads newline-delimited JSON source events, applies the
// given mapping to each, and writes the normalized results into store. It
// returns the resulting EvidenceIDs in corpus order.
//
// This is the function the Phase 2 gate's replay requirement exercises:
// "replay a recorded pcap/log corpus through the pipeline twice;
// byte-identical evidence sets" (phases/PHASES.md). Byte-identical follows
// directly from ledger.NewEvidenceID's own determinism (Phase 1) — this
// function just has to canonicalize the SAME logical event the SAME way
// every time, which the mapping's fixed field list already guarantees.
func ReplayCorpus(store *ledger.Store, mapping *Mapping, lines [][]byte) ([]ledger.EvidenceID, error) {
	ids := make([]ledger.EvidenceID, 0, len(lines))
	for i, line := range lines {
		if len(bytes.TrimSpace(line)) == 0 {
			continue // tolerate blank lines in a corpus file
		}
		raw, err := decodeJSONLine(line)
		if err != nil {
			return nil, fmt.Errorf("ingest: corpus line %d: %w", i, err)
		}
		normalized, err := mapping.Apply(raw)
		if err != nil {
			return nil, fmt.Errorf("ingest: corpus line %d: %w", i, err)
		}
		id, err := store.Put(normalized)
		if err != nil {
			return nil, fmt.Errorf("ingest: corpus line %d: %w", i, err)
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// decodeJSONLine decodes one JSON object using json.Number for numeric
// fields (never float64) — mapping.go's convertValue/convertPassthrough
// depend on seeing json.Number so they can reject anything that isn't a
// whole int64 explicitly, rather than silently losing precision the way
// Go's default float64 decoding would.
func decodeJSONLine(line []byte) (map[string]any, error) {
	dec := json.NewDecoder(bytes.NewReader(line))
	dec.UseNumber()
	var v map[string]any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return v, nil
}
