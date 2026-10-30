# System App Nuker + App Manager metadata — architecture and open gates

This fork **preserves** the System App Nuker execution engine and UAD-NG runtime updates. The App Manager / Android Debloat List (ADL) adds warnings, alternatives, classification, and supplemental dependencies. It does not replace UAD-NG coverage.

## Data sources and licensing

- UAD-NG: https://github.com/Universal-Debloater-Alliance/universal-android-debloater-next-generation — GPL-3.0; current package ratings and descriptions continue to come from `webui/src/lib/uad.ts`.
- Android Debloat List: https://github.com/MuntashirAkon/android-debloat-list — **AGPL-3.0-or-later**; generated `webui/public/adl.json` contains transformed ADL content. Corresponding source is the upstream ADL JSON files at `sources.adl.revision`, plus `webui/scripts/fetch-adl.cjs`. The full license text lives in the ADL source repo's `COPYING`.
- App Manager: https://github.com/MuntashirAkon/AppManager — GPL-3.0-or-later; compiled suggestion metadata at `sources.suggestions.revision`.
- System App Nuker: https://github.com/chisewaguri/systemapp_nuker — GPL-3.0.

Every build records immutable source revision SHA hashes; the JSON is deterministic for those revisions. Preserve source attribution, notices, and licenses. Check your source redistribution obligations before publishing a modified release.

## Policy

1. Keep UAD-NG current and independent. Map ADL `delete → recommended`, `replace → advanced`, `caution → expert`, and `unsafe → unsafe`.
2. Use the **more restrictive** classification. Unknown is not silently lowered to recommended by older ADL data.
3. Protected Android core packages cannot be newly added via UI, import, or package-based shell nuke list. Preexisting removals can still be restored.
4. Expert, unsafe, and unknown removals require manual per-app confirmation on Home. Importing any of those in a config is denied, requiring manual review.
5. Preserve and display both ratings, disagreements, ADL warnings and references, alternatives, and union of UAD/ADL dependencies. Sources are contextual recommendations, not absolute device-specific truths.

The shell guard is intentionally narrow. **Raw filesystem whiteouts are not covered**, and a ROM may rely on more packages than the fixed protected list. Don't interpret the guard as complete device safety.

## Integration points

- `webui/scripts/fetch-adl.cjs`: fetched ADL and UAD extras, validated and written atomically, with source commits.
- `webui/src/lib/metadata.ts`: read bundled snapshot and combine with existing UAD runtime data.
- Home, AppList, AppInfoDialog and NukeConfig: risk UI and import preflight.
- `module/nuke.sh`: protect new core Android package IDs; original engine and rollback routines preserved.
- `upstream-sync.yml`: daily ordinary upstream merge; run ShellCheck, tests, lint, metadata fetch, build; only then non-forced push. Conflict creates issue. Branch protection gets a PR fallback.
- `metadata-refresh.yml`: weekly reviewed ADL update PR (never silently lowers a rating).

## Verification status

Passed offline: Node syntax, import fixture + deterministic `--check`, strict TypeScript isolated resolver check, Bash bootstrap syntax, Python patch script compilation. Full upstream `pnpm test`/`lint`/`build` and real-device behavior **are not yet verified**. Actions should run on your GitHub fork after you push. Avoid tagging a release until then.

## Follow-up backlog

- P1: post-boot Android SystemUI/launcher readiness watchdog for failures after `sys.boot_completed=1`, avoiding false positives from a locked or inactive phone.
- P1: comprehensive fail-closed authorization for all privileged ingress (including raw whiteouts), tied to an explicit reviewed operation receipt.
- P1: compare all database classification downgrades and removed warnings in metadata update PRs.
- P1: full device-/ROM-specific policy and package dependency presentation.
- P2: extend localization, prove offline reproducible release builds, real-device acceptance matrix and long-term fork migration.
