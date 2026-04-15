# Justfile — VSMS task runner surface (Phase 0.3, D-05..D-11)
set shell := ["bash", "-cu"]
set dotenv-load := true
export FORCE_COLOR := "1"

# Default recipe: show the list.
default:
    @just --list

# ---- D-07 fast check ----
[group('check')]
check: typecheck lint format-check test-unit

[group('check')]
typecheck:
    pnpm typecheck

[group('check')]
lint:
    pnpm lint

[group('check')]
format-check:
    pnpm exec prettier --check "**/*.{ts,tsx,md,json}"

# ---- D-05 / D-19..D-22 test tiers ----
# D-05: `just test` runs all three tiers sequentially.
# D-06: `just test <feature>` filters by path substring across all tiers.
[group('test')]
test feature="":
    just test-unit {{feature}}
    just test-api {{feature}}
    just test-e2e {{feature}}

[group('test')]
test-unit feature="":
    pnpm exec vitest run {{feature}}

[group('test')]
test-api feature="":
    pnpm exec playwright test --project=api {{feature}}

[group('test')]
test-e2e feature="":
    pnpm exec playwright test --project=e2e {{feature}}

# D-09: interactive debugger for E2E
[group('test')]
test-e2e-ui:
    pnpm exec playwright test --project=e2e --ui

# D-11: coverage for unit tier, no thresholds
[group('test')]
coverage:
    pnpm exec vitest run --coverage

# ---- D-08 CI gate ----
[group('ci')]
ci: check test-api test-e2e
    pnpm build
