# Fork CI/CD: target pipeline and current status

This fork ships the upstream release machinery unchanged, with one addition: the
release identity points at `Chuwhyangle/PI-Desktop` instead of upstream (see
`FORK.md`). This file is the map of how a change travels from a local edit to an
auto-updating install, which parts are already proven, and how to verify each
part.

Legend: `[x]` verified working · `[~]` configured but never exercised ·
`[ ]` missing · `[!]` broken or blocking

## Pipeline

```
 (1) LOCAL
     developer edits -> git push feature branch
         |
         v
 (2) PULL REQUEST  ................................................ PR gate
     +--------------------------+---------------------------------------+
     | pr-base.yml              | head must contain the base tip        | [x]
     | ci.yml          (js)     | Node 24 + pnpm frozen, build:js,      | [x]
     |                          | typecheck, lint, architecture, tests  |
     | ci.yml          (rust)   | fmt, clippy, cargo test host-core     | [x]
     | docs-check.yml           | docs + AGENTS/CLAUDE policy sync      | [~]
     |                          | path-filtered: docs/**, AGENTS.md,    |
     |                          | CLAUDE.md, changelog*.ts, check-*.mjs |
     |                          | so a code-only PR skips it            |
     | e2e.yml (fork, new)      | 9 host-core protocol probes, measured | [x]
     |                          | to run with no Electron binary at all |
     |                          | (a CI runner has none)                |
     | [ ] Electron e2e         | the other 43 need Electron (a         |
     |                          | display), a network marketplace, or   |
     |                          | an extra bundle step                  |
     +--------------------------+---------------------------------------+
     | [x] ruleset `main-protection`: pull request + the four checks above
     |     + up-to-date branch, no bypass actors -> a direct push to main
     |     is rejected (GH013)
     | [x] auto-merge armed on the PR -> GitHub merges it when the checks pass
         |
         | merge (the ruleset performs it; no manual click)
         v
 (3) MAIN  ......................................................... integration
     ci.yml re-runs on every push to main                        [x] green
     [ ] nightly / unsigned build -> beta channel                (not built)
         |
         | node scripts/release.mjs <version> --tag
         | git push fork v<version>
         v
 (4) RELEASE  ...................................................... tag builds
     release.yml  (trigger: tag v*.*.* | workflow_dispatch)
       verify ............ mirrors the ci.yml gate; a tag push does not
                           trigger ci.yml, so this is the only gate   [~]
         |
       build (matrix, fail-fast off)                                  [~]
         |- macos-15          arm64 -> dmg + zip  (unsigned by default)
         |- macos-15-intel    x64   -> dmg + zip  (unsigned by default)
         |- windows-latest    x64   -> nsis + zip + portable
         +- ubuntu-22.04      x64   -> AppImage + deb + rpm + asar
             each entry also builds the native Rust host-core sidecar
         |
       pi-host-bundle ..... headless linux bundle + .sha256           [~]
         |
       publish ............ merges latest-mac-arm64/x64 -> latest-mac.yml
                            softprops/action-gh-release
                            prerelease = tag contains "-"             [~]
         v
 (5) DISTRIBUTION
     GitHub Release on Chuwhyangle/PI-Desktop                       [ ]
       |- installers (see matrix above)
       |- pi-host-<ver>-linux-<arch>.tar.gz + .sha256
       +- latest.yml / latest-mac.yml / latest-linux.yml  <- update feed
     [ ] CN mirror: mirror-to-cnb.yml is gated on
         github.repository == 'vastsa/PI-Desktop', so it never runs in this
         fork; a mirror has to be built separately (own server)
         |
         v
 (6) CLIENT AUTO-UPDATE
     installed app reads app-update.yml
       (baked from apps/desktop/package.json build.publish)
       -> checks every 6h, downloads, installs on quit               [ ]
     [!] allowPrerelease is hard-coded false while release.yml marks
         "-" tags as prerelease: beta releases never reach an install
     [ ] no staged rollout / rollback beyond "ship another patch"
```

## Status: where the fork stands today

| # | Stage | State | Evidence |
| --- | --- | --- | --- |
| 1 | Local edit + push | `[x]` | `main` at `a28e106`, pushed over SSH |
| 2 | PR gate, end to end | `[x]` | PR #1 exercised the three checks; PR #2 proved the whole loop: a failing check blocked the merge, the fix turned it green, **auto-merge then merged it unassisted** (`06385c6`), and the branch was deleted. A direct push to `main` is rejected (`GH013`). The gate has since grown to four checks (see the E2E row) |
| 3 | Main CI | `[x]` | run `896c5f0` on `main`: JS 3.7 min + Rust 1.6 min, both success |
| 4 | Tag release | `[ ]` | **no tag and no release exists yet**; `release.yml` never ran |
| 5 | Distribution | `[ ]` | no GitHub Release, no update feed published |
| 6 | Client auto-update | `[ ]` | never observed; `allowPrerelease` fix still pending |
| - | E2E in CI | `[x]` | `e2e.yml` runs 9 host-core protocol probes, each measured to pass with no Electron binary present. Green on the runner in 3m42s (PR #4), and now the fourth required check. The other 43 probes need Electron, a network marketplace, or an extra bundle step; upstream runs none at all |
| - | Supply chain | `[ ]` | no provenance, SBOM, or SHA-pinned actions |
| - | Local clone | `[!]` | clone is `--depth 1`; `git merge upstream/main` fails on unrelated histories |

Two side notes from the PR run: a CodeRabbit app is installed on this account and
reported `Review skipped: manual review required for this OSS repository`, so it
does not act as a gate; and `docs-check.yml` is path-filtered, so verifying it
needs a PR that touches `docs/**`, `AGENTS.md`, `CLAUDE.md`, or
`scripts/check-*.mjs`.

What is deliberately **not** on this fork's roadmap: macOS signing. There is no
Apple Developer account, so `MACOS_SIGNING` stays unset and the unsigned lane
runs; macOS users must open the app with right-click -> Open the first time.

## How to verify each stage

### Stage 3 (already proven)

```powershell
gh run list --repo Chuwhyangle/PI-Desktop --limit 5
```
Push any commit to `main` and watch `CI` go green in about 4 minutes.

### Stage 2 (PR gate) - verified end to end

Two pull requests did the work.

**PR #1** exercised the three checks on their own: `Head contains latest base`
(14s), `JS build / typecheck / lint / architecture / test` (4m13s), and
`Rust host-core format / lint / test` (2m1s), all green. It was closed without
merging and its branch deleted. `docs-check.yml` correctly stayed out, because it
is path-filtered to `docs/**`, `README*.md`, `AGENTS.md`, `CLAUDE.md`,
`packages/shared/src/changelog*.ts`, `scripts/check-*.mjs`, and `docs/scripts/**`
and that PR touched none of them.

**PR #2** proved the whole loop, including the failure path:

1. the ruleset was installed (pull request + the three checks + up-to-date
   branch, zero bypass actors) and `allow_auto_merge` was switched on;
2. the PR was armed with `gh pr merge --auto --squash`;
3. the first run **failed** - `ci.yml` still ignored `docs/**`, and the contract
   test that pinned that behaviour had to be restated - so the merge was held;
4. the fix turned the checks green and **GitHub merged the PR by itself**
   (`06385c6`, squash), then deleted the branch;
5. a deliberate direct push to `main` was rejected with
   `GH013: Repository rule violations found`, listing "Changes must be made
   through a pull request" and "3 of 3 required status checks are expected".

That is the whole gate: it passes, it blocks, it merges itself, and nobody can
walk around it. The day-to-day commands are in `FORK-WORKFLOW.md`.

### Stage 4 (tag release) - the first end-to-end proof

```powershell
node scripts/release.mjs 0.16.0-beta.2 --tag
git push fork v0.16.0-beta.2
```
Then:
```powershell
gh run list --repo Chuwhyangle/PI-Desktop --limit 5
gh release view --repo Chuwhyangle/PI-Desktop v0.16.0-beta.2
```
Expect: `verify` green, four `build` entries green, `pi-host-bundle` green,
`publish` green, and a Release carrying the installers plus `latest*.yml`.
A `-` in the tag marks it a prerelease, which is what keeps it away from
existing installs until Stage 6 is fixed.

Because every installer is unsigned, expect a SmartScreen prompt on Windows and
a Gatekeeper prompt on macOS. That is the documented trade-off, not a failure.

### Stage 6 (auto-update) - after Stage 4 succeeds

1. Install the Windows artifact from the release (NSIS or portable).
2. Confirm the baked feed points here: the installed app's
   `resources/app-update.yml` must say `owner: Chuwhyangle`.
3. Push a second, higher tag (`v0.16.0-beta.3`).
4. The installed app should offer the update within its check interval (or on
   demand from the app's update action).
5. To make beta tags reachable at all, `allowPrerelease` in
   `apps/desktop/electron/main/updater.ts` has to become configurable - that is
   the Phase 2 change, and without it only non-`-` tags update an install.

## Suggested order

1. **Stage 4** - prove one tag produces a complete, installable release. Highest
   value: stages 5 and 6 are unreachable without it, and it needs no secrets.
2. **Stage 2, last step** - done. `main` requires the four checks and no actor may
   bypass them. The remaining additions are the ones listed below.
3. **Stage 6 enabler** - make `allowPrerelease` configurable, then define the
   nightly / beta / stable channels. Until then only non-`-` tags reach an
   install, i.e. there is exactly one channel.
4. **Stage 5 addition** - CN mirror on the operator's own server, since
   `mirror-to-cnb.yml` never runs in this fork.
5. **Stage 2 addition, part two** - the 43 probes that need Electron. The 9
   headless ones already run in `e2e.yml`; the rest need a display and therefore
   a self-hosted runner (Windows, or Linux with Xvfb). Until then, a change that
   passes every unit test and every headless probe can still break the UI, and
   nothing in CI would notice.
