package ingest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not locate repo root (no go.mod found in any parent directory)")
		}
		dir = parent
	}
}

func loadTestMapping(t *testing.T, name string) *Mapping {
	t.Helper()
	m, err := LoadMapping(filepath.Join(repoRoot(t), "mappings", name))
	if err != nil {
		t.Fatalf("LoadMapping(%s): %v", name, err)
	}
	return m
}

func decodeTestLine(t *testing.T, line string) map[string]any {
	t.Helper()
	dec := json.NewDecoder(strings.NewReader(line))
	dec.UseNumber()
	var v map[string]any
	if err := dec.Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestLoadMapping_RealFiles(t *testing.T) {
	for _, name := range []string{"cloudtrail.ocsf.yaml", "entra_signin.ocsf.yaml"} {
		m := loadTestMapping(t, name)
		if m.SourceID == "" || m.MappingVersion == "" || m.SchemaVersion == "" {
			t.Fatalf("%s: envelope fields incomplete: %+v", name, m)
		}
		if len(m.Fields) == 0 {
			t.Fatalf("%s: no fields defined", name)
		}
	}
}

func TestLoadMapping_RejectsMissingEnvelopeFields(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.ocsf.yaml")
	// missing schema_version
	if err := os.WriteFile(path, []byte("source_id: x\nmapping_version: \"1\"\nfields: {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadMapping(path); err == nil {
		t.Fatal("expected an error loading a mapping missing schema_version")
	}
}

func TestMapping_Apply_CloudTrail(t *testing.T) {
	m := loadTestMapping(t, "cloudtrail.ocsf.yaml")
	raw := decodeTestLine(t, `{
		"eventTime":"2026-09-07T14:20:58Z",
		"eventName":"ConsoleLogin",
		"eventSource":"signin.amazonaws.com",
		"awsRegion":"us-east-1",
		"sourceIPAddress":"203.0.113.44",
		"userIdentity":{"type":"IAMUser","arn":"arn:aws:iam::123456789012:user/jdoe","userName":"jdoe"},
		"responseElements":{"ConsoleLogin":"Success"},
		"userAgent":"Mozilla/5.0"
	}`)

	out, err := m.Apply(raw)
	if err != nil {
		t.Fatal(err)
	}

	if out["schema_version"] != "1.0.0" || out["mapping_version"] != "1" || out["source_id"] != "aws-cloudtrail" {
		t.Fatalf("envelope wrong: %+v", out)
	}

	actor, ok := out["actor"].(map[string]any)
	if !ok {
		t.Fatalf("expected nested actor map, got %#v", out["actor"])
	}
	user, ok := actor["user"].(map[string]any)
	if !ok {
		t.Fatalf("expected nested actor.user map, got %#v", actor["user"])
	}
	if user["uid"] != "arn:aws:iam::123456789012:user/jdoe" {
		t.Fatalf("actor.user.uid wrong: %#v", user["uid"])
	}
	if user["name"] != "jdoe" {
		t.Fatalf("actor.user.name wrong: %#v", user["name"])
	}

	wantTimeNS := int64(1788790858000000000) // 2026-09-07T14:20:58Z in UTC ns since epoch
	if out["time"] != wantTimeNS {
		t.Fatalf("time wrong: got %#v, want %d", out["time"], wantTimeNS)
	}

	unmapped, ok := out["unmapped"].(map[string]any)
	if !ok {
		t.Fatalf("expected unmapped passthrough map, got %#v", out["unmapped"])
	}
	if _, ok := unmapped["userAgent"]; !ok {
		t.Fatal("expected userAgent to be carried into unmapped")
	}
	if _, ok := unmapped["eventName"]; ok {
		t.Fatal("eventName was explicitly mapped — it should NOT also appear in unmapped")
	}
}

func TestMapping_Apply_MissingFieldIsSkippedNotErrored(t *testing.T) {
	m := loadTestMapping(t, "entra_signin.ocsf.yaml")
	// no "status" field at all in this event
	raw := decodeTestLine(t, `{
		"createdDateTime":"2026-09-07T14:20:58Z",
		"userPrincipalName":"jdoe@example.com",
		"userId":"11111111-2222-3333-4444-555555555555",
		"ipAddress":"203.0.113.44",
		"appDisplayName":"Office 365"
	}`)
	out, err := m.Apply(raw)
	if err != nil {
		t.Fatalf("expected no error for an event missing an optional field, got: %v", err)
	}
	if status, ok := out["status"]; ok {
		t.Fatalf("did not expect a status field to be set at all, got %#v", status)
	}
}

func TestMapping_Apply_UntypedNumberIsRejected(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.ocsf.yaml")
	yamlContent := "source_id: x\nmapping_version: \"1\"\nschema_version: \"1.0.0\"\nfields:\n  n:\n    from: n\n"
	if err := os.WriteFile(path, []byte(yamlContent), 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := LoadMapping(path)
	if err != nil {
		t.Fatal(err)
	}
	raw := decodeTestLine(t, `{"n": 42}`)
	if _, err := m.Apply(raw); err == nil {
		t.Fatal("expected an error mapping an untyped numeric field")
	}
}

func TestMapping_Apply_BadTimestampIsRejected(t *testing.T) {
	m := loadTestMapping(t, "cloudtrail.ocsf.yaml")
	raw := decodeTestLine(t, `{"eventTime": "not-a-timestamp"}`)
	if _, err := m.Apply(raw); err == nil {
		t.Fatal("expected an error on a malformed timestamp")
	}
}
