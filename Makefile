SHELL := /bin/bash
.DEFAULT_GOAL := help

AUDIT_DIR := .audit

.PHONY: help bootstrap audit notices dev-up dev-down clean

help:
	@echo "make bootstrap  - install toolchains/hooks needed for local development"
	@echo "make audit      - run the full license/SBOM gate (docs/LICENSE-POLICY.md)"
	@echo "make notices    - regenerate THIRD-PARTY-NOTICES.md from the latest audit"
	@echo "make dev-up     - start the Phase 0 dev stack (docker compose)"
	@echo "make dev-down   - stop the Phase 0 dev stack"

## --- bootstrap -------------------------------------------------------------

bootstrap:
	@echo "== bootstrap =="
	@mkdir -p $(AUDIT_DIR)
	@command -v pre-commit >/dev/null 2>&1 && pre-commit install || \
		echo "  [skip] pre-commit not installed — run 'pip install .[dev]' first"
	@command -v cargo >/dev/null 2>&1 && rustup show >/dev/null 2>&1 || \
		echo "  [skip] Rust toolchain not found locally — required for kernel/, provisioned in CI"
	@command -v go >/dev/null 2>&1 || \
		echo "  [skip] Go toolchain not found locally — required for ledger/agent/ingest, provisioned in CI"
	@command -v docker >/dev/null 2>&1 || \
		echo "  [skip] Docker not found locally — required for dev-up/dev-down, provisioned in CI"
	@echo "bootstrap complete"

## --- audit (docs/LICENSE-POLICY.md "Enforcement") ---------------------------

audit: bootstrap
	@echo "== audit: python =="
	@if command -v pip-licenses >/dev/null 2>&1; then \
		pip-licenses --format=json --with-urls > $(AUDIT_DIR)/py-licenses.json && \
		echo "  wrote $(AUDIT_DIR)/py-licenses.json"; \
	else \
		echo "  [skip] pip-licenses not installed (pip install .[dev])"; \
	fi
	@echo "== audit: js/ts (root) =="
	@if [ -f package.json ]; then \
		npx --yes license-checker-rseidelsohn --production --json --out $(AUDIT_DIR)/js-licenses.json 2>/dev/null && \
		echo "  wrote $(AUDIT_DIR)/js-licenses.json" || echo "  [skip] no resolvable JS dependency tree yet"; \
	fi
	@echo "== audit: js/ts (web/ — the shipped product's actual runtime dependency tree) =="
	@if [ -f web/package.json ]; then \
		cd web && npx --yes license-checker-rseidelsohn --production --json --out ../$(AUDIT_DIR)/js-licenses-web.json 2>/dev/null && \
		echo "  wrote $(AUDIT_DIR)/js-licenses-web.json" || echo "  [skip] web/ dependency tree not installed yet"; \
	fi
	@echo "== audit: go =="
	@if command -v go-licenses >/dev/null 2>&1; then \
		go-licenses report ./... > $(AUDIT_DIR)/go-licenses.csv 2>/dev/null && \
		echo "  wrote $(AUDIT_DIR)/go-licenses.csv" || echo "  [skip] no Go packages yet"; \
	else \
		echo "  [skip] go-licenses not installed"; \
	fi
	@echo "== audit: rust =="
	@if command -v cargo-deny >/dev/null 2>&1; then \
		cargo deny check licenses 2>&1 | tee $(AUDIT_DIR)/cargo-deny.log; \
	else \
		echo "  [skip] cargo-deny not installed"; \
	fi
	@echo "== audit: sbom =="
	@if command -v syft >/dev/null 2>&1; then \
		syft . -o spdx-json > $(AUDIT_DIR)/sbom.spdx.json && \
		echo "  wrote $(AUDIT_DIR)/sbom.spdx.json"; \
	else \
		echo "  [skip] syft not installed"; \
	fi
	@echo "== audit: allowlist gate =="
	@python3 scripts/check_licenses.py || python scripts/check_licenses.py
	@$(MAKE) notices

notices:
	@python3 scripts/gen_third_party_notices.py || python scripts/gen_third_party_notices.py

## --- dev stack ---------------------------------------------------------------

dev-up:
	docker compose -f docker-compose.dev.yml up -d

dev-down:
	docker compose -f docker-compose.dev.yml down

clean:
	rm -rf $(AUDIT_DIR)/*.json $(AUDIT_DIR)/*.csv $(AUDIT_DIR)/*.log
