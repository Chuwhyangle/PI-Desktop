# Fork workflow: how a change reaches `main`

This fork (`Chuwhyangle/PI-Desktop`) protects `main` with a repository ruleset, so
**every change goes through a pull request and merges itself once CI is green**.
Nobody pushes to `main` directly, administrators included.

Read this before changing anything. `FORK.md` lists what differs from upstream;
`FORK-CICD.md` maps the whole pipeline and what is still missing.

## The one rule

`main` accepts no direct push. The ruleset `main-protection` requires:

| Requirement | Consequence |
| --- | --- |
| Pull request | a branch has to open a PR before it can land |
| 3 status checks green | CI must pass on the branch |
| Branch up to date with `main` | the tested commit is the one that lands |
| No bypass actors | the rule applies to the owner too |

A direct push fails with `GH013: Repository rule violations found for
refs/heads/main` and the two reasons above. That is the rule working, not a
broken remote.

## Daily flow

```powershell
# 1. start from a fresh main
git switch main
git pull fork main

# 2. branch, change, commit
git switch -c feat/short-description
# ...edit...
git commit -am "feat(scope): what changed and why"

# 3. push the branch
git push -u fork feat/short-description

# 4. open the pull request
gh pr create --repo Chuwhyangle/PI-Desktop --base main --fill

# 5. arm auto-merge: this is the step that removes the manual click
gh pr merge --repo Chuwhyangle/PI-Desktop --auto --squash
```

Then walk away. When the required checks turn green, GitHub merges the PR, and
`delete_branch_on_merge` removes the branch. Nothing else to do.

`--auto` only arms the merge; it does not merge immediately. If a check fails the
PR simply stays open, still armed, and merges by itself as soon as a later push
turns the checks green.

## The three required checks

| Check | Workflow | Runs when |
| --- | --- | --- |
| `Head contains latest base` | `pr-base.yml` | every pull request |
| `JS build / typecheck / lint / architecture / test` | `ci.yml` | every pull request and push to `main` |
| `Rust host-core format / lint / test` | `ci.yml` | every pull request and push to `main` |

A fourth workflow, `docs-check.yml`, also runs on pull requests, but only when the
change touches documentation or policy paths (`docs/**`, `README*.md`,
`AGENTS.md`, `CLAUDE.md`, `packages/shared/src/changelog*.ts`,
`scripts/check-*.mjs`). It is deliberately **not** a required check: because it is
path-filtered, requiring it would leave every code-only pull request waiting on a
check that never reports.

## Why approvals are zero

`required_approving_review_count` is `0`. GitHub does not let you approve your own
pull request, so requiring one approval would make every pull request from the
owner unmergeable. The gate here is CI, not human review.

## Watching and fixing

```powershell
# what is happening on a pull request
gh pr checks --repo Chuwhyangle/PI-Desktop <number>

# is it armed, blocked, or merged
gh pr view <number> --repo Chuwhyangle/PI-Desktop `
  --json state,mergeStateStatus,autoMergeRequest,statusCheckRollup

# recent runs
gh run list --repo Chuwhyangle/PI-Desktop --limit 10

# read a failure
gh run view --repo Chuwhyangle/PI-Desktop <run-id> --log-failed
```

### Two pull requests open at once

The "branch up to date" rule means the second pull request needs `main` merged
into it before it may land, and GitHub does not do that on its own. One command:

```powershell
gh pr update-branch <number> --repo Chuwhyangle/PI-Desktop
```

Auto-merge then proceeds without any further input.

### A failed check

Read the log, fix the cause on the same branch, commit, push. The pull request
stays armed, so it merges on the next green run. Do not disable the ruleset to
get past a failure; that is the mechanism that keeps `main` working.

## What this workflow does not cover

Tagging and releasing is a separate, **manual** step, precisely so that landing
code and shipping a build stay distinct:

```powershell
node scripts/release.mjs <version> --tag
git push fork v<version>
```

That triggers `release.yml`, which builds four platforms and publishes a GitHub
Release. See `FORK-CICD.md` for the state of that half of the pipeline, including
what is still missing (a beta/stable channel, a China mirror, E2E in CI).

## See also

* `FORK.md` - every deliberate difference from upstream, and how to pull
  upstream updates without losing them.
* `FORK-CICD.md` - the target pipeline, what is verified, and how to verify the rest.
