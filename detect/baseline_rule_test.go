package detect

import (
	"path/filepath"
	"testing"

	"github.com/Kaushik2210/attesta/detect/stats"
)

// TestPinnedBaselineSnapshot_ReplayIsDeterministic is the Phase 4 gate,
// end to end, against a real shipped rule (not just detect/stats' own
// unit tests): "baseline snapshot hash is stable and reproducible;
// replaying a corpus against a pinned snapshot reproduces identical
// statistical claims" (phases/PHASES.md).
func TestPinnedBaselineSnapshot_ReplayIsDeterministic(t *testing.T) {
	rule, err := LoadRule(filepath.Join(rulesDir(t), "auth-from-new-asn.cdl.yaml"))
	if err != nil {
		t.Fatal(err)
	}

	history, err := LoadFixture(filepath.Join(rulesDir(t), "fixtures", "asn_baseline_history.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	current, err := LoadFixture(filepath.Join(rulesDir(t), "fixtures", "asn_new_asn_positive.jsonl"))
	if err != nil {
		t.Fatal(err)
	}

	// Warm up once -- this is the "pin" step. Two independently-warmed
	// stores from the identical history must produce the identical
	// snapshot hash (stability/reproducibility), and the pinned snapshot
	// must produce the identical claim set no matter how many times it's
	// replayed against (determinism).
	pinned1 := stats.NewStore(rule.Baseline.WarmupThreshold)
	if err := WarmUpBaseline(rule, history, pinned1); err != nil {
		t.Fatal(err)
	}
	pinned2 := stats.NewStore(rule.Baseline.WarmupThreshold)
	if err := WarmUpBaseline(rule, history, pinned2); err != nil {
		t.Fatal(err)
	}

	hash1, _, err := pinned1.SnapshotHash()
	if err != nil {
		t.Fatal(err)
	}
	hash2, _, err := pinned2.SnapshotHash()
	if err != nil {
		t.Fatal(err)
	}
	if hash1 != hash2 {
		t.Fatalf("two independently-warmed stores from the identical history produced different snapshot hashes: %s vs %s", hash1, hash2)
	}

	var firstKeys []ClaimKey
	for i := 0; i < 5; i++ {
		claims, err := EvaluateStreaming(rule, current, pinned1)
		if err != nil {
			t.Fatalf("replay %d: %v", i, err)
		}
		keys := ClaimKeys(claims)
		if i == 0 {
			firstKeys = keys
			continue
		}
		if len(keys) != len(firstKeys) {
			t.Fatalf("replay %d: claim count drifted: %d vs %d", i, len(keys), len(firstKeys))
		}
		for j := range keys {
			if keys[j] != firstKeys[j] {
				t.Fatalf("replay %d: claim set drifted from replay 0: %+v vs %+v", i, keys, firstKeys)
			}
		}
	}
	if len(firstKeys) == 0 {
		t.Fatal("expected at least one claim (AUTH_FROM_NEW_ASN) from the positive fixture against the pinned snapshot")
	}

	// The pinned snapshot itself must be unchanged by having been
	// queried repeatedly -- a "pinned" snapshot that drifted under read
	// load would defeat the entire point.
	hashAfter, _, err := pinned1.SnapshotHash()
	if err != nil {
		t.Fatal(err)
	}
	if hashAfter != hash1 {
		t.Fatal("the pinned snapshot's hash changed after being replayed against — reads must never mutate it")
	}
}

// TestBenignCorpus_FalsePositiveRates is the Phase 4 gate's third
// requirement: "Measured FP rate per family on a benign corpus is
// recorded (this number goes in the paper)" (phases/PHASES.md). This is
// a small, illustrative reference-engine measurement, not a
// publication-grade statistical sample (see phases/reports/PHASE-04.md)
// -- but it's a real measurement against real rules, not a placeholder.
func TestBenignCorpus_FalsePositiveRates(t *testing.T) {
	benign, err := LoadFixture(filepath.Join(rulesDir(t), "fixtures", "benign_corpus.jsonl"))
	if err != nil {
		t.Fatal(err)
	}

	for _, name := range shippedRuleFiles {
		name := name
		t.Run(name, func(t *testing.T) {
			rule, err := LoadRule(filepath.Join(rulesDir(t), name))
			if err != nil {
				t.Fatal(err)
			}
			warmup := int64(1)
			if rule.Baseline != nil {
				warmup = rule.Baseline.WarmupThreshold
			}
			store := stats.NewStore(warmup)
			if rule.Baseline != nil {
				// Warm the baseline from the benign corpus's own earlier
				// activity, exactly like a real deployment's first days --
				// the point of this measurement is whether NORMAL activity
				// trips a rule, not whether an unwarmed baseline does.
				if err := WarmUpBaseline(rule, benign, store); err != nil {
					t.Fatal(err)
				}
			}
			claims, err := EvaluateStreaming(rule, benign, store)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("FP measurement: rule=%s events=%d claims=%d", rule.ID, len(benign), len(claims))
			if len(claims) != 0 {
				t.Errorf("rule %s produced %d claim(s) against the benign corpus (expected 0): %+v", rule.ID, len(claims), ClaimKeys(claims))
			}
		})
	}
}
