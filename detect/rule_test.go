package detect

import (
	"os"
	"path/filepath"
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

func rulesDir(t *testing.T) string {
	return filepath.Join(repoRoot(t), "rules")
}

var shippedRuleFiles = []string{
	"auth-burst-then-success.cdl.yaml",
	"token-replayed.cdl.yaml",
	"impossible-travel.cdl.yaml",
}

func TestLoadRule_AllShippedRulesValidate(t *testing.T) {
	for _, name := range shippedRuleFiles {
		path := filepath.Join(rulesDir(t), name)
		if _, err := LoadRule(path); err != nil {
			t.Errorf("LoadRule(%s): %v", name, err)
		}
	}
}

// TestLoadRule_RejectsRuleWithoutNegativeFixture is the Phase 3 gate's
// third requirement, verbatim: "Compiler rejects a rule lacking a
// negative fixture" (phases/PHASES.md).
func TestLoadRule_RejectsRuleWithoutNegativeFixture(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "no-negative.cdl.yaml")
	content := `
id: cdl.test.no-negative
version: 1
title: test rule with no negative fixture
severity: low
entity: actor.user.uid
sources:
  s:
    from: ocsf.authentication
    where: 'activity_id == 1'
    group_by: [actor.user.uid]
emits:
  - predicate: TEST_PREDICATE
    when: 's.count >= 1'
tests:
  - fixture: fixtures/positive.jsonl
    expect: [TEST_PREDICATE]
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadRule(path); err == nil {
		t.Fatal("expected an error loading a rule with no negative (empty-expect) fixture")
	}
}

func TestLoadRule_RejectsSuppressWithoutReason(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad-suppress.cdl.yaml")
	content := `
id: cdl.test.bad-suppress
version: 1
title: test rule with an unreasoned suppress clause
severity: low
entity: actor.user.uid
sources:
  s:
    from: ocsf.authentication
    where: 'activity_id == 1'
    group_by: [actor.user.uid]
emits:
  - predicate: TEST_PREDICATE
    when: 's.count >= 1'
suppress:
  - when: 's.count > 100'
tests:
  - fixture: fixtures/positive.jsonl
    expect: [TEST_PREDICATE]
  - fixture: fixtures/negative.jsonl
    expect: []
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadRule(path); err == nil {
		t.Fatal("expected an error loading a rule with a suppress clause missing its reason")
	}
}

func TestLoadRule_RejectsEntityNotInAnyGroupBy(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad-entity.cdl.yaml")
	content := `
id: cdl.test.bad-entity
version: 1
title: test rule whose entity is never grouped on
severity: low
entity: does.not.exist
sources:
  s:
    from: ocsf.authentication
    where: 'activity_id == 1'
    group_by: [actor.user.uid]
emits:
  - predicate: TEST_PREDICATE
    when: 's.count >= 1'
tests:
  - fixture: fixtures/positive.jsonl
    expect: [TEST_PREDICATE]
  - fixture: fixtures/negative.jsonl
    expect: []
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadRule(path); err == nil {
		t.Fatal("expected an error loading a rule whose entity field is never a group_by field")
	}
}
