# Papercuts

Small, non-blocking friction in the repository itself — the kind that will
waste the next contributor's time too. Log it in the moment; review and fix
entries in a separate, user-requested cleanup pass.

This is not a completed-work log, a bug tracker, or a place for the agent's own
sandbox/shell/network hiccups. Never include secrets, credentials, personal
data, or sensitive paths.

## Open

- [ ] `2026-07-16T14:27:21Z` — `codex` — `pnpm db:generate` shells into `npm run db:generate:*`, causing npm to warn about multiple pnpm-only config keys on every migration generation. Call the child scripts with `pnpm run` (or invoke Drizzle directly) to keep the standard migration path quiet.
- [ ] `2026-07-14T01:28:30Z` — `claude` — Regenerating the lockfile (adding or moving a dep) makes `pnpm install` re-run the `minimumReleaseAge` gate on transitive peers already pinned at that exact version (`mysql2`, `sql-escaper`, `@aws-sdk/credential-providers`), failing the install even though nothing about them changed. `pnpm install --config.minimumReleaseAge=0` — then confirm the lockfile diff stays version-neutral — unblocks it; worth documenting that regen step so the gate doesn't re-block already-pinned versions.
- [ ] `2026-07-10T21:28:46Z` — `codex` — `pnpm --dir badseo run typecheck` works through the root toolchain but `pnpm --dir badseo run build` can't find Vite because `badseo/node_modules` is absent. Document or enforce the package-local install before validating the `badseo/` subpackage.
- [ ] `2026-07-10T21:32:10Z` — `codex` — Formatting the `badseo/` workspace with `pnpm exec prettier` fails because Prettier is only available from the repository root. Document the root-only formatter command or expose a workspace-local formatting script.
- [ ] `2026-07-18T10:20:00Z` — `claude` — A test file that imports any service module which pulls in a repository (e.g. `KeywordResearchRepository`, `RankTrackingRepository`) fails to load with `Cannot find package 'cloudflare:workers'`, because `@/db` reads the Workers `env` binding at module top-level. Even a test that only exercises a pure helper from that file needs `vi.mock("cloudflare:workers", () => ({ env: {} }))` (see `RankTrackingService.test.ts`). Worth a shared test-setup helper or documented snippet so new service tests don't rediscover this.

## Resolved

Move fixed entries here, mark them checked, and append the resolving date or commit.
