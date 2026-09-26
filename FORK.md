# PI-Desktop fork (Chuwhyangle/PI-Desktop)

This repository is a fork of [vastsa/PI-Desktop](https://github.com/vastsa/PI-Desktop).
Everything upstream ships is unchanged except the fork-specific patches listed
below, which keep this fork's release pipeline, auto-update feed, and issue
links pointing at **this** repository instead of the upstream one, and keep the
macOS release lane usable on a fork that has no Apple Developer account.

The patches are deliberately small and local so that rebasing onto `upstream/main`
stays cheap. `apps/desktop/test/fork-identity.test.mjs` is the guard line: it
fails as soon as a rebase restores an upstream identity.

## Fork differences

Identity (three places must always agree):

| # | File | Change |
| --- | --- | --- |
| 1 | `apps/desktop/package.json` | `build.publish[0].owner` is `"Chuwhyangle"` (`repo` stays `"PI-Desktop"`). electron-builder bakes this into `app-update.yml`, i.e. the update feed of every installed build. |
| 2 | `apps/desktop/electron/main/updater.ts` | `RELEASES_URL` points at `https://github.com/Chuwhyangle/PI-Desktop/releases/latest` (the "open release page" fallback, also allowlisted as an external URL). |
| 3 | `packages/shared/src/github-feedback.ts` | `GITHUB_REPO` is `"Chuwhyangle/PI-Desktop"` (the in-app bug-report link). |

macOS signing lane (`release.yml` only; the fork has no Apple Developer account,
so signing is off by default and no upstream Apple identity is written down):

| # | File | Change |
| --- | --- | --- |
| 4 | `.github/workflows/release.yml` | `MACOS_SIGN_RELEASE` additionally requires the repository variable `MACOS_SIGNING == 'true'`, so tag builds are unsigned unless the variable is set. |
| 5 | `.github/workflows/release.yml` | The team check compares `APPLE_TEAM_ID` against the `APPLE_TEAM_ID` repository variable (and fails with a clear message when that variable is unset) instead of comparing against the upstream team ID. |
| 6 | `.github/workflows/release.yml` | `CSC_NAME` comes from the `APPLE_SIGN_IDENTITY` repository variable instead of a hard-coded certificate name. |
| 7 | `.github/workflows/ci.yml` | The `docs/**` and `**/*.md` path filters are removed, so CI reports on every pull request. A required check that never reports leaves a pull request pending on "Expected" forever, which would deadlock auto-merge for a docs-only change. |
| 8 | `AGENTS.md`, `CLAUDE.md` | Both carry a short fork-workflow entry point pointing at `FORK-WORKFLOW.md`, and both bump `Policy-Sync` to the same token so `pnpm check:agent-policy` stays green. The step-by-step flow lives in `FORK-WORKFLOW.md`, as `AGENTS.md` §19 prescribes for multi-step flows. |
| 9 | `.github/workflows/e2e.yml` (new) | Runs the headless end-to-end probes that drive host-core over its real protocol. Upstream runs no end-to-end probe in CI at all, which this fork cannot afford because it auto-merges on green: a change can pass every unit test and still break the RPC surface. A new file, so an upstream merge cannot conflict with it. |
| 10 | `.gitignore` | Ignores `.artifacts/`, the screenshots, fixtures and result dumps `scripts/e2e-*.mjs` writes while a probe runs. Upstream leaves it untracked-but-not-ignored, so `git add -A` after a local e2e run sweeps a hundred generated files into the commit. |

Tests updated so the identity lives in one place:

* `apps/desktop/test/auto-update.test.mjs` derives the expected feed owner/repo
  from `apps/desktop/package.json` / `updater.ts` instead of pinning `"vastsa"`.
* `packages/shared/src/github-feedback.test.ts` derives its fixture repository
  from the exported `GITHUB_REPO`.
* `apps/desktop/test/ci-workflow.test.mjs` asserts the parameterized signing
  gate instead of the upstream team ID and certificate name.
* `apps/desktop/test/fork-identity.test.mjs` (new) asserts that the three
  identity places agree with each other and never fall back to `vastsa/PI-Desktop`,
  and that `release.yml` stays unsigned by default with no upstream Apple identity.
* `apps/desktop/test/ci-workflow.test.mjs` also asserts that `ci.yml` has no path
  filter at all, inverting the upstream assertion that docs-only changes are
  skipped (see divergence 7).

Not forked on purpose: `.github/workflows/mirror-to-cnb.yml` is gated on
`github.repository == 'vastsa/PI-Desktop'` because the CNB mirror credentials
only exist upstream. Leave that gate alone.

Known remaining upstream references (cosmetic, no runtime effect):
`apps/desktop/package.json` `homepage`/`author`, the comments, docs, and local
scripts that mention the upstream Apple team (`scripts/release-macos.sh`,
`scripts/verify-macos-release.sh`, `scripts/macos-signing-diagnostics.sh`,
`scripts/notarize-and-staple-macos-release-dmg.sh`,
`apps/desktop/build/entitlements.mac.plist`). Those local signing scripts still
default to the upstream identity and are unusable in this fork; the GitHub
Actions lane is the supported path.

## Pulling upstream updates

```bash
git remote add upstream https://github.com/vastsa/PI-Desktop.git   # once
git fetch upstream

git switch -c chore/upstream-sync-<date> origin/main              # or the fork branch you sync
git rebase upstream/main
```

Rebase onto `upstream/main`; do not merge upstream into the fork's `main` from
anywhere else, and never merge a task branch into `main` locally.

Conflicts normally land in exactly the six places above. When one does, keep the
fork value and re-check that the three identity copies still match.

After every rebase, run:

```bash
pnpm --filter @pi-desktop/desktop test
```

`apps/desktop/test/fork-identity.test.mjs` is the identity defence: if an
upstream change reintroduces `vastsa/PI-Desktop` anywhere, or pins the Apple
team ID again, this suite fails and names both sides of the mismatch. Also run
`pnpm --filter @pi-desktop/shared test` after touching
`packages/shared/src/github-feedback.ts`.

## GitHub repository configuration

The fork does not inherit upstream settings; configure these once:

* **Actions**: enable workflows (forks have them disabled by default).
* **Repository variables** (Settings → Secrets and variables → Actions → Variables):
  * `MACOS_SIGNING` — leave unset (unsigned releases) or set to `true` to enable
    the macOS signing lane.
  * `APPLE_TEAM_ID` — required only when `MACOS_SIGNING=true`; the team ID both
    the guard and the packaging step compare against.
  * `APPLE_SIGN_IDENTITY` — required only when `MACOS_SIGNING=true`; the bare
    certificate common name, e.g. `Your Name (TEAMID123)`, without the
    `Developer ID Application:` prefix electron-builder rejects.
* **Secrets** (only when enabling macOS signing):
  `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
  `APPLE_TEAM_ID`. When `MACOS_SIGNING` is not `true` the workflow never reads
  them and publishes unsigned macOS artifacts.
* Release tags still follow the upstream flow: `node scripts/release.mjs X.Y.Z --tag`
  then `git push fork <branch> vX.Y.Z`. The release lands on **this** fork's
  Releases page, which is what the packaged `app-update.yml` points at.
* **Ruleset `main-protection`** (Settings → Rules → Rulesets): requires a pull
  request, the four status checks (`Head contains latest base`,
  `JS build / typecheck / lint / architecture / test`,
  `Rust host-core format / lint / test`,
  `E2E headless (host-core protocol probes)`), and an up-to-date branch, with **no
  bypass actors**, so even the owner cannot push to `main` directly. Applied with
  `gh api -X POST repos/Chuwhyangle/PI-Desktop/rulesets --input <file>`.
  `required_approving_review_count` is `0` on purpose: GitHub forbids approving
  your own pull request, so any higher value would make the owner's pull requests
  unmergeable.
* **Auto-merge enabled** (`allow_auto_merge`) and **`delete_branch_on_merge`
  enabled**, so a pull request merges itself once the required checks pass and its
  branch is cleaned up.
* The day-to-day flow built on those settings is in `FORK-WORKFLOW.md`.

## Unsigned artifacts

* **macOS**: unsigned/un-notarized builds are blocked by Gatekeeper
  ("... can't be opened because Apple cannot check it for malicious software").
  Users must right-click → Open (or `xattr -dr com.apple.quarantine` on the
  `.app`) once. Without a Developer ID certificate there is no way around this;
  enable `MACOS_SIGNING` once a certificate exists.
* **Windows**: unsigned NSIS/ZIP builds trigger a SmartScreen "Windows protected
  your PC" warning; users need "More info → Run anyway". An authenticode
  certificate removes it.
* **Linux**: unaffected.
