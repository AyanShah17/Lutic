---
name: update-mds
description: >-
  Updates RECENT_CHANGES.md, PROJECT_STRUCTURE.md, and ISSUES.md (plus cross-referenced
  counts and capability notes in IMPLEMENTATION_SUMMARY.md, DEVELOPMENT_PLAN.md,
  SECURITY.md, README.md, and PRODUCTION.md) in the workspace root to match the current
  codebase. Use when the user invokes /update-mds or asks to refresh the changelog,
  project structure inventory, or issues ledger.
---

# Update Project Markdown Documentation

Keep [RECENT_CHANGES.md](../../../RECENT_CHANGES.md), [PROJECT_STRUCTURE.md](../../../PROJECT_STRUCTURE.md), and [ISSUES.md](../../../ISSUES.md)—plus any cross-referenced verification tables and capability statements in [IMPLEMENTATION_SUMMARY.md](../../../IMPLEMENTATION_SUMMARY.md), [DEVELOPMENT_PLAN.md](../../../DEVELOPMENT_PLAN.md), [SECURITY.md](../../../SECURITY.md), [README.md](../../../README.md), and [PRODUCTION.md](../../../PRODUCTION.md)—strictly accurate against the live workspace files.

## Steps

1. **Inspect current codebase changes & run post-edit verification first**:
   - Check `git status` / `git diff` / `git log` (or inspect modified files directly if `.git` metadata is absent) to identify what changed, why each change was necessary, and which tests verify it.
   - Run relevant post-edit checks (`typecheck`, `typecheck:e2e-paas`, `lint`, `test`, `@lutic/mobile test`, `eval`, `test:e2e`, `build`, `test:e2e:prod`) before syncing documentation so recorded counts, skips (`tests/postgres-integration.test.ts` without `POSTGRES_TEST_URL`), and timings reflect the final code state.
2. **Update `RECENT_CHANGES.md`**:
   - For each change, record: **What changed** (exact files and functions/routes), **Why** (the bug, race condition, security gap, or requirement solved), and **Verified by** (exact test case or command result, explicitly noting any skipped cases).
3. **Rescan structure & update `PROJECT_STRUCTURE.md`**:
   - Walk `apps/`, `packages/`, `deploy/`, `tests/`, `e2e-paas/`, `.github/`, and `.agents/skills/` (skipping `node_modules`, `.next`, `.data`, `test-results`).
   - Add any new folders/files, remove deleted ones, and update exported functions, classes, components, API methods, MCP tools (including disabled/contained flags such as `[Disabled — P0-07]`), and Drizzle schema tables from actual file contents.
4. **Re-audit open limitations & update `ISSUES.md` (and cross-referenced docs)**:
   - Search for production stubs/unsupported errors (`501`, `CodeModeContainedError`, `!isDemoMode()`, `Stub`, `Mock`), skipped tests (`skipIf`), and unverified host dependencies (`postgres-integration.test.ts`, Docker, ClamAV, live LLMs).
   - Remove fixed issues, add newly discovered or contained ones, and state every issue in plain English with exact `[file](file#Lstart-Lend)` links and function/symbol names.
   - Sync matching test counts, CI steps, and capability notes in `IMPLEMENTATION_SUMMARY.md`, `DEVELOPMENT_PLAN.md`, `SECURITY.md`, `README.md`, and `PRODUCTION.md` so no root markdown file contradicts another.
5. **Verify on disk**:
   - Read back the modified sections of the updated files to confirm links, line numbers, symbols, and counts match reality on disk.
