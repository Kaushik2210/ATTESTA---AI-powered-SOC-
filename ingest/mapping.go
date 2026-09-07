// Package ingest implements the declarative source-to-OCSF normalization
// pipeline described in docs/ARCHITECTURE.md §2.2: each source has a
// mapping (mappings/*.ocsf.yaml) compiled into a transform. The mapping
// version participates in every event's hash (via the schema_version /
// mapping_version / source_id envelope fields), so a mapping change
// produces new evidence nodes rather than mutating history — never a
// silent reinterpretation of what a past event meant.
//
// Scope note (see phases/reports/PHASE-02.md): this package implements the
// mapping MECHANISM against two representative sources (AWS CloudTrail,
// Entra ID sign-ins), not the full OCSF class registry — modeling every
// OCSF event class is later, incremental work that doesn't change how this
// pipeline behaves.
package ingest

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// FieldMapping describes how to populate one target field of the
// normalized event from one field of the raw source event.
type FieldMapping struct {
	// From is a dot-separated path into the raw (already JSON-decoded)
	// source event, e.g. "userIdentity.arn".
	From string `yaml:"from"`
	// Type coerces the raw value. Empty means "pass through as-is"
	// (only valid for strings, bools, and null — a JSON number without
	// an explicit type is rejected, see convertValue). "int" parses a
	// whole-number JSON value to int64. "timestamp_ns" parses an
	// RFC 3339 timestamp string to UTC nanoseconds since epoch,
	// matching docs/ARCHITECTURE.md §2.2's canonicalization rule.
	Type string `yaml:"type,omitempty"`
}

// Mapping is one compiled mappings/*.ocsf.yaml file.
type Mapping struct {
	SourceID       string                  `yaml:"source_id"`
	MappingVersion string                  `yaml:"mapping_version"`
	SchemaVersion  string                  `yaml:"schema_version"`
	// Fields maps target field path -> how to derive it. Target paths
	// with a "." nest into the output, e.g. "actor.user.uid" produces
	// output["actor"]["user"]["uid"].
	Fields map[string]FieldMapping `yaml:"fields"`
	// UnmappedPassthrough, when true, carries every raw top-level field
	// not consumed by any entry in Fields into output["unmapped"],
	// verbatim (recursively type-converted, still hashed) — never
	// silently dropped. docs/ARCHITECTURE.md §2.2.
	UnmappedPassthrough bool `yaml:"unmapped_passthrough"`
}

// LoadMapping reads and validates one mapping file.
func LoadMapping(path string) (*Mapping, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("ingest: reading mapping %s: %w", path, err)
	}
	var m Mapping
	if err := yaml.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("ingest: parsing mapping %s: %w", path, err)
	}
	if m.SourceID == "" || m.MappingVersion == "" || m.SchemaVersion == "" {
		return nil, fmt.Errorf("ingest: mapping %s: source_id, mapping_version, and schema_version are all required", path)
	}
	return &m, nil
}

// Apply normalizes one raw, already-JSON-decoded source event (map values
// are string, bool, nil, json.Number, []any, or map[string]any — the shape
// produced by decodeJSONLine's json.Number-aware decoder) into a canonical
// event ready for ledger.NewEvidenceID.
//
// Known limitation (see phases/reports/PHASE-02.md): unmapped-field
// tracking is TOP-LEVEL only. If a mapping consumes even one sub-field of
// a raw top-level object (e.g. "userIdentity.arn"), the WHOLE
// "userIdentity" object is considered consumed and none of its other
// sub-fields reach output["unmapped"] — so "userIdentity.type" in that
// example is silently dropped, not hashed. This understates
// docs/ARCHITECTURE.md §2.2's "unknown/vendor fields preserved under
// unmapped" guarantee for partially-mapped nested objects. A mapping
// author works around it today by explicitly mapping every sub-field of
// any object it touches at all; the real fix is path-level (not
// top-level) consumption tracking, deferred as a refinement rather than
// blocking Phase 2's mechanism-proving scope.
func (m *Mapping) Apply(raw map[string]any) (map[string]any, error) {
	out := map[string]any{
		"schema_version":  m.SchemaVersion,
		"mapping_version": m.MappingVersion,
		"source_id":       m.SourceID,
	}

	consumedTop := make(map[string]bool, len(m.Fields))
	for target, fm := range m.Fields {
		rawVal, ok := lookupPath(raw, fm.From)
		if !ok {
			continue // this event doesn't carry that field; not every source event has every field
		}
		converted, err := convertValue(rawVal, fm.Type)
		if err != nil {
			return nil, fmt.Errorf("ingest: field %q (from %q): %w", target, fm.From, err)
		}
		setPath(out, target, converted)
		consumedTop[topSegment(fm.From)] = true
	}

	if m.UnmappedPassthrough {
		unmapped := map[string]any{}
		for k, v := range raw {
			if consumedTop[k] {
				continue
			}
			converted, err := convertPassthrough(v)
			if err != nil {
				return nil, fmt.Errorf("ingest: unmapped field %q: %w", k, err)
			}
			unmapped[k] = converted
		}
		if len(unmapped) > 0 {
			out["unmapped"] = unmapped
		}
	}

	return out, nil
}

func convertValue(rawVal any, kind string) (any, error) {
	switch kind {
	case "":
		switch t := rawVal.(type) {
		case string, bool, nil:
			return t, nil
		case json.Number:
			return nil, fmt.Errorf("numeric value %q needs an explicit type (int or timestamp_ns) — untyped numbers are rejected so canonicalization never has to guess at fixed-point precision", t.String())
		default:
			return nil, fmt.Errorf("unsupported raw value type %T for an untyped field", rawVal)
		}
	case "int":
		num, ok := rawVal.(json.Number)
		if !ok {
			return nil, fmt.Errorf("type=int requires a JSON number, got %T", rawVal)
		}
		n, err := num.Int64()
		if err != nil {
			return nil, fmt.Errorf("type=int value %q is not a whole int64 (floats are unsupported): %w", num.String(), err)
		}
		return n, nil
	case "timestamp_ns":
		s, ok := rawVal.(string)
		if !ok {
			return nil, fmt.Errorf("type=timestamp_ns requires a string, got %T", rawVal)
		}
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return nil, fmt.Errorf("type=timestamp_ns value %q is not RFC 3339: %w", s, err)
		}
		return t.UnixNano(), nil
	default:
		return nil, fmt.Errorf("unknown field type %q", kind)
	}
}

// convertPassthrough recursively converts a raw JSON-decoded value (as
// produced by decodeJSONLine) into the value shapes
// ledger.EncodeCanonical accepts. It rejects any JSON number that isn't a
// whole int64 — like convertValue, this reference pipeline never guesses
// at a fixed-point conversion for a field a mapping didn't explicitly type.
func convertPassthrough(v any) (any, error) {
	switch t := v.(type) {
	case nil, bool, string:
		return t, nil
	case json.Number:
		n, err := t.Int64()
		if err != nil {
			return nil, fmt.Errorf("unmapped numeric value %q is not a whole int64 (floats are unsupported; map this field explicitly with a type)", t.String())
		}
		return n, nil
	case []any:
		out := make([]any, len(t))
		for i, item := range t {
			converted, err := convertPassthrough(item)
			if err != nil {
				return nil, err
			}
			out[i] = converted
		}
		return out, nil
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, item := range t {
			converted, err := convertPassthrough(item)
			if err != nil {
				return nil, err
			}
			out[k] = converted
		}
		return out, nil
	default:
		return nil, fmt.Errorf("unsupported unmapped value type %T", v)
	}
}

func lookupPath(m map[string]any, path string) (any, bool) {
	segs := strings.Split(path, ".")
	var cur any = m
	for _, seg := range segs {
		cm, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		v, exists := cm[seg]
		if !exists {
			return nil, false
		}
		cur = v
	}
	return cur, true
}

func setPath(m map[string]any, path string, value any) {
	segs := strings.Split(path, ".")
	cur := m
	for i, seg := range segs {
		if i == len(segs)-1 {
			cur[seg] = value
			return
		}
		next, ok := cur[seg].(map[string]any)
		if !ok {
			next = map[string]any{}
			cur[seg] = next
		}
		cur = next
	}
}

func topSegment(path string) string {
	if i := strings.IndexByte(path, '.'); i >= 0 {
		return path[:i]
	}
	return path
}
