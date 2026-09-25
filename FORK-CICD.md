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
     | [ ] e2e-smoke.yml        | needs a self-hosted runner            |
     +--------------------------+---------------------------------------+
     | [ ] branch protection on main requiring the checks above
         |
         | merge (only when the gate is green)
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
| 1 | Local edit + push | `[x]` | `main` at `d6e73c1`, pushed over SSH |
| 2 | PR gate | `[x]` | PR #1: `PR base` 14s, `CI / js` 4m13s, `CI / rust` 2m1s, all pass. `main` still unprotected |
| 3 | Main CI | `[x]` | run `896c5f0` on `main`: JS 3.7 min + Rust 1.6 min, both success |
| 4 | Tag release | `[ ]` | **no tag and no release exists yet**; `release.yml` never ran |
| 5 | Distribution | `[ ]` | no GitHub Release, no update feed published |
| 6 | Client auto-update | `[ ]` | never observed; `allowPrerelease` fix still pending |
| - | E2E in CI | `[ ]` | no workflow runs any `test:e2e:*` (upstream has none either) |
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

### Stage 2 (PR gate) - verified, one step left

Verified by opening PR #1 (`test/pr-gate`, a throwaway non-doc file because
`ci.yml` ignores markdown). All three required checks passed:

| check | workflow | time |
| --- | --- | --- |
| `Head contains latest base` | pr-base.yml | 14s |
| `JS build / typecheck / lint / architecture / test` | ci.yml | 4m13s |
| `Rust host-core format / lint / test` | ci.yml | 2m1s |

The PR was closed without merging and the branch deleted, so nothing was left
behind. `docs-check.yml` correctly stayed out: it is path-filtered to
`docs/**`, `README*.md`, `AGENTS.md`, `CLAUDE.md`,
`packages/shared/src/changelog*.ts`, `scripts/check-*.mjs`, and
`docs/scripts/**`, and the smoke PR touched none of them.

**Still missing: branch protection.** `GET /branches/main/protection` answers
`Branch not protected`, so the three checks above run but nothing requires them.
Set `Settings -> Branches -> Add branch protection rule` for `main`, enable
"Require status checks to pass", and select the three checks. Until then the
gate is advisory and a red PR can still be merged.

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
2. **Stage 2, last step** - protect `main` with the three checks the smoke PR
   just exercised, so the gate stops being advisory.
3. **Stage 6 enabler** - make `allowPrerelease` configurable, then define the
   nightly / beta / stable channels. Until then only non-`-` tags reach an
   install, i.e. there is exactly one channel.
4. **Stage 5 addition** - CN mirror on the operator's own server, since
   `mirror-to-cnb.yml` never runs in this fork.
5. **Stage 2 addition** - E2E on a self-hosted runner. This is the largest
   remaining hole: no workflow runs any `test:e2e:*`, upstream included.
