---
name: check-issues
description: >-
  Audits ISSUES.md and the Lutic codebase to explain every active issue,
  unsupported production path, stub, or unverified test gap in simple words while
  pointing to the exact file, function, and line number creating it. Use when the
  user invokes /check-issues or asks what issues currently exist in the project.
---

# Check and Explain Current Project Issues

Surface real problems, disabled production paths, and unverified gaps clearly in plain English with exact source locations.

## Steps

1. **Read the current issue ledger**:
   - Read [ISSUES.md](../../../ISSUES.md) in the repository root as the baseline list.
2. **Verify against live source code**:
   - Spot-check or search the codebase for unimplemented/stubbed production behavior (`501`, `!isDemoMode()`, `StubReranker`, `LocalMockEmbeddingProvider`), skipped tests (`describe.skipIf`, `.skip`), temporary workarounds (`shortcut:`, `TODO`), and unverified infrastructure checks (`tests/postgres-integration.test.ts`, `.github/workflows/ci.yml`, `deploy/backup-restore.sh`).
   - Optionally run `bun run typecheck` or `bun run test` if checking for newly broken builds or tests.
3. **Report issues in simple words**:
   - Group findings cleanly (Broken/Blocked in Production, Search/PDF Limits, Unverified Infrastructure, Missing Integrations).
   - For every issue include:
     - **What happens (simple words)**: plain-English impact without jargon.
     - **Why it happens**: the underlying missing integration, stub, or environment requirement.
     - **Exact source**: clickable `file://` link with line numbers plus the exact function/class/symbol name causing it.
4. **Update if drifted**:
   - If you found a newly introduced issue or confirmed a listed issue was fixed, offer to run `/update-mds` (or update `ISSUES.md` if asked).
