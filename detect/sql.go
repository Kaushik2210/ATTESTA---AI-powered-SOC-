// This file compiles a Rule to SQL and executes it against an embedded,
// pure-Go SQLite database (modernc.org/sqlite) rather than a live
// ClickHouse instance. That's a deliberate stand-in, not the real target:
// no ClickHouse is available in this environment to validate against
// (see phases/reports/PHASE-03.md). The SQL this compiler emits is
// written in a portable subset (standard aggregate functions, CTEs,
// correlated subqueries) chosen to be plausible ClickHouse SQL too, but
// dialect differences between SQLite and ClickHouse are unverified here
// — reconciling them is future work once a live ClickHouse is available
// (docker-compose.dev.yml already provisions one; it has never been run
// end to end in this environment either).
package detect

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"

	"github.com/Kaushik2210/attesta/detect/expr"
	_ "modernc.org/sqlite"
)

func flattenColumnName(path []string) string {
	return strings.Join(path, "_")
}

// flattenEvent recursively flattens a normalized event's nested maps into
// a single-level map keyed by underscore-joined column names, ready to
// become one row of the SQLite "events" table.
func flattenEvent(prefix string, v any, out map[string]any) {
	switch t := v.(type) {
	case map[string]any:
		for k, sub := range t {
			key := k
			if prefix != "" {
				key = prefix + "_" + k
			}
			flattenEvent(key, sub, out)
		}
	default:
		out[prefix] = v
	}
}

// anchorSource picks the source with the most group_by fields (ties
// broken by name for determinism) and validates every other source's
// group_by is a subset of it — the join shape this reference SQL
// compiler supports. See detect/aggregate.go's unionGroupFields for the
// streaming engine's equivalent (more general) approach.
func anchorSource(sources map[string]SourceSpec) (string, error) {
	names := make([]string, 0, len(sources))
	for name := range sources {
		names = append(names, name)
	}
	sort.Strings(names)

	anchor := names[0]
	for _, name := range names {
		if len(sources[name].GroupBy) > len(sources[anchor].GroupBy) {
			anchor = name
		}
	}
	anchorSet := make(map[string]bool, len(sources[anchor].GroupBy))
	for _, f := range sources[anchor].GroupBy {
		anchorSet[f] = true
	}
	for _, name := range names {
		if name == anchor {
			continue
		}
		for _, f := range sources[name].GroupBy {
			if !anchorSet[f] {
				return "", fmt.Errorf("source %q's group_by field %q is not part of anchor source %q's group_by — this SQL compiler only supports sources whose grouping is a subset of the most fine-grained source's", name, f, anchor)
			}
		}
	}
	return anchor, nil
}

func compileSourceCTE(name string, src SourceSpec, funcsSQL map[string]expr.FuncSQL) (string, error) {
	whereNode, err := expr.Parse(src.Where)
	if err != nil {
		return "", err
	}
	mainCols := func(path []string) (string, error) { return flattenColumnName(path), nil }
	whereMain, err := expr.ToSQL(whereNode, mainCols, funcsSQL)
	if err != nil {
		return "", err
	}

	groupCols := make([]string, len(src.GroupBy))
	for i, f := range src.GroupBy {
		groupCols[i] = flattenColumnName(splitPath(f))
	}

	selectParts := append([]string{}, groupCols...)
	selectParts = append(selectParts, "COUNT(*) AS count", "MIN(time) AS first_ts", "MAX(time) AS last_ts")

	for _, f := range src.TrackDistinct {
		col := flattenColumnName(splitPath(f))
		selectParts = append(selectParts, fmt.Sprintf("COUNT(DISTINCT %s) AS distinct_%s", col, fieldAlias(f)))
	}

	for _, f := range src.TrackLast {
		col := flattenColumnName(splitPath(f))
		subCols := func(path []string) (string, error) { return "sub." + flattenColumnName(path), nil }
		whereSub, err := expr.ToSQL(whereNode, subCols, funcsSQL)
		if err != nil {
			return "", err
		}
		// Both sides of the correlation must be explicitly qualified.
		// "sub" and the outer query's own table both have an identically
		// named column (they're both `events`), so a bare, unqualified
		// name on the right-hand side would resolve to "sub"'s own
		// column — the innermost scope wins in standard SQL name
		// resolution — making the condition a tautology
		// ("sub.x = sub.x") instead of a real correlation to the
		// enclosing group. Aliasing the outer table as "outer_ev" and
		// qualifying both sides removes the ambiguity.
		eqParts := make([]string, len(groupCols))
		for i, gc := range groupCols {
			eqParts[i] = fmt.Sprintf("sub.%s = outer_ev.%s", gc, gc)
		}
		subquery := fmt.Sprintf(
			"(SELECT sub.%s FROM events sub WHERE %s AND %s ORDER BY sub.time DESC LIMIT 1)",
			col, whereSub, strings.Join(eqParts, " AND "),
		)
		selectParts = append(selectParts, subquery+" AS last_"+fieldAlias(f))
	}

	return fmt.Sprintf(
		"%s_agg AS (SELECT %s FROM events AS outer_ev WHERE %s GROUP BY %s)",
		name, strings.Join(selectParts, ", "), whereMain, strings.Join(groupCols, ", "),
	), nil
}

func sqlColumnResolver(sources map[string]SourceSpec) expr.ColumnResolver {
	return func(path []string) (string, error) {
		if len(path) < 2 {
			return "", fmt.Errorf("detect: expected <source>.<field> in SQL context, got %v", path)
		}
		srcName, field := path[0], path[1]
		if _, ok := sources[srcName]; !ok {
			return "", fmt.Errorf("detect: unknown source %q", srcName)
		}
		switch {
		case field == "count":
			return fmt.Sprintf("COALESCE(%s.count, 0)", srcName), nil
		case field == "exists":
			return fmt.Sprintf("(COALESCE(%s.count, 0) > 0)", srcName), nil
		case field == "first_ts":
			return srcName + ".first_ts", nil
		case field == "last_ts":
			return srcName + ".last_ts", nil
		case strings.HasPrefix(field, "distinct_"):
			return fmt.Sprintf("COALESCE(%s.%s, 0)", srcName, field), nil
		case strings.HasPrefix(field, "last_"):
			return srcName + "." + field, nil
		default:
			// Fall back to this source's own group_by columns, mirroring
			// aggregateEnv's fallback in env.go — e.g. "failures.src_endpoint_ip"
			// reads back a group_by field directly, the same mechanism
			// suppress clauses use rather than a separate one.
			for _, f := range sources[srcName].GroupBy {
				if flattenColumnName(splitPath(f)) == field {
					return srcName + "." + field, nil
				}
			}
			return "", fmt.Errorf("detect: unknown aggregate field %q for source %q (not count/exists/first_ts/last_ts/distinct_*/last_*, and not a group_by field)", field, srcName)
		}
	}
}

// CompileRuleSQL compiles a rule to one standalone SQL query per emit
// clause, each returning the (entity, observed) pairs for cases where
// that predicate fires.
func CompileRuleSQL(rule *Rule) (map[string]string, error) {
	funcsSQL := builtinFuncsSQL()

	names := make([]string, 0, len(rule.Sources))
	for name := range rule.Sources {
		names = append(names, name)
	}
	sort.Strings(names)

	anchor, err := anchorSource(rule.Sources)
	if err != nil {
		return nil, fmt.Errorf("detect: rule %s: %w", rule.ID, err)
	}

	ctes := make([]string, 0, len(names))
	for _, name := range names {
		cte, err := compileSourceCTE(name, rule.Sources[name], funcsSQL)
		if err != nil {
			return nil, fmt.Errorf("detect: rule %s, source %q: %w", rule.ID, name, err)
		}
		ctes = append(ctes, cte)
	}

	fromClause := fmt.Sprintf("%s_agg AS %s", anchor, anchor)
	for _, name := range names {
		if name == anchor {
			continue
		}
		eqParts := make([]string, 0, len(rule.Sources[name].GroupBy))
		for _, f := range rule.Sources[name].GroupBy {
			col := flattenColumnName(splitPath(f))
			eqParts = append(eqParts, fmt.Sprintf("%s.%s = %s.%s", anchor, col, name, col))
		}
		fromClause += fmt.Sprintf(" LEFT JOIN %s_agg AS %s ON %s", name, name, strings.Join(eqParts, " AND "))
	}

	cols := sqlColumnResolver(rule.Sources)
	entityCol := fmt.Sprintf("%s.%s", anchor, flattenColumnName(splitPath(rule.Entity)))

	out := make(map[string]string, len(rule.Emits))
	for _, emit := range rule.Emits {
		whenNode, err := expr.Parse(emit.When)
		if err != nil {
			return nil, fmt.Errorf("detect: rule %s, emit %q: %w", rule.ID, emit.Predicate, err)
		}
		whenSQL, err := expr.ToSQL(whenNode, cols, funcsSQL)
		if err != nil {
			return nil, fmt.Errorf("detect: rule %s, emit %q: %w", rule.ID, emit.Predicate, err)
		}

		observedSQL := "NULL"
		if emit.Observed != "" {
			obsNode, err := expr.Parse(emit.Observed)
			if err != nil {
				return nil, fmt.Errorf("detect: rule %s, emit %q: %w", rule.ID, emit.Predicate, err)
			}
			observedSQL, err = expr.ToSQL(obsNode, cols, funcsSQL)
			if err != nil {
				return nil, fmt.Errorf("detect: rule %s, emit %q: %w", rule.ID, emit.Predicate, err)
			}
		}

		suppressSQL := ""
		if len(rule.Suppress) > 0 {
			var parts []string
			for _, s := range rule.Suppress {
				node, err := expr.Parse(s.When)
				if err != nil {
					return nil, fmt.Errorf("detect: rule %s, suppress: %w", rule.ID, err)
				}
				// Suppress clauses use the same "<source>.<field>"
				// resolution as when/observed (see env.go's
				// aggregateEnv and this file's sqlColumnResolver) --
				// one column-resolution mechanism for every rule
				// clause, not a second one just for suppress.
				sql, err := expr.ToSQL(node, cols, funcsSQL)
				if err != nil {
					return nil, fmt.Errorf("detect: rule %s, suppress: %w", rule.ID, err)
				}
				parts = append(parts, sql)
			}
			suppressSQL = " AND NOT (" + strings.Join(parts, " OR ") + ")"
		}

		query := fmt.Sprintf(
			"WITH %s SELECT %s AS entity, %s AS observed FROM %s WHERE %s%s",
			strings.Join(ctes, ", "), entityCol, observedSQL, fromClause, whenSQL, suppressSQL,
		)
		out[emit.Predicate] = query
	}
	return out, nil
}

// RunSQL creates a fresh in-memory SQLite database, loads the flattened
// events, compiles the rule, and executes each emit's query -- the SQL
// path's counterpart to EvaluateStreaming.
func RunSQL(rule *Rule, events []map[string]any) ([]Claim, error) {
	queries, err := CompileRuleSQL(rule)
	if err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", "file::memory:")
	if err != nil {
		return nil, fmt.Errorf("detect: opening sqlite: %w", err)
	}
	defer db.Close()

	columns := collectColumns(events)
	if err := createEventsTable(db, columns); err != nil {
		return nil, err
	}
	if err := insertEvents(db, columns, events); err != nil {
		return nil, err
	}

	var claims []Claim
	for _, emit := range rule.Emits {
		query := queries[emit.Predicate]
		rows, err := db.Query(query)
		if err != nil {
			return nil, fmt.Errorf("detect: rule %s, emit %q: executing SQL: %w\nquery:\n%s", rule.ID, emit.Predicate, err, query)
		}
		for rows.Next() {
			var entity, observed any
			if err := rows.Scan(&entity, &observed); err != nil {
				rows.Close()
				return nil, fmt.Errorf("detect: rule %s, emit %q: scanning row: %w", rule.ID, emit.Predicate, err)
			}
			claims = append(claims, Claim{
				Predicate:     emit.Predicate,
				EntityValue:   renderScalar(normalizeSQLValue(entity)),
				ObservedValue: normalizeSQLValue(observed),
				RuleID:        rule.ID,
				RuleVersion:   rule.Version,
			})
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("detect: rule %s, emit %q: %w", rule.ID, emit.Predicate, err)
		}
		rows.Close()
	}
	return claims, nil
}

// normalizeSQLValue converts a database/sql-scanned value into the same
// Go types the streaming path produces ([]byte -> string), so Claims from
// both paths compare equal.
func normalizeSQLValue(v any) any {
	if b, ok := v.([]byte); ok {
		return string(b)
	}
	return v
}

func collectColumns(events []map[string]any) []string {
	seen := map[string]bool{}
	var cols []string
	for _, ev := range events {
		flat := map[string]any{}
		flattenEvent("", ev, flat)
		for k := range flat {
			if !seen[k] {
				seen[k] = true
				cols = append(cols, k)
			}
		}
	}
	sort.Strings(cols)
	return cols
}

func createEventsTable(db *sql.DB, columns []string) error {
	if len(columns) == 0 {
		return fmt.Errorf("detect: no events to build a schema from")
	}
	_, err := db.Exec("CREATE TABLE events (" + strings.Join(columns, ", ") + ")")
	if err != nil {
		return fmt.Errorf("detect: creating events table: %w", err)
	}
	return nil
}

func insertEvents(db *sql.DB, columns []string, events []map[string]any) error {
	placeholders := make([]string, len(columns))
	for i := range columns {
		placeholders[i] = "?"
	}
	stmt, err := db.Prepare("INSERT INTO events (" + strings.Join(columns, ", ") + ") VALUES (" + strings.Join(placeholders, ", ") + ")")
	if err != nil {
		return fmt.Errorf("detect: preparing insert: %w", err)
	}
	defer stmt.Close()

	for _, ev := range events {
		flat := map[string]any{}
		flattenEvent("", ev, flat)
		args := make([]any, len(columns))
		for i, col := range columns {
			args[i] = flat[col] // nil (Go nil, not sql.NullX) for absent fields — SQLite stores it as NULL
		}
		if _, err := stmt.Exec(args...); err != nil {
			return fmt.Errorf("detect: inserting event: %w", err)
		}
	}
	return nil
}
