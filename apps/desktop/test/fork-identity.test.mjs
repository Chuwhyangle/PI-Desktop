/**
 * Fork identity guard.
 *
 * This repository is a fork of vastsa/PI-Desktop (Chuwhyangle/PI-Desktop) and
 * keeps rebasing upstream. Upstream hard-codes its own GitHub identity in three
 * places, and a rebase restores any of them silently — the shipped app would
 * then check for updates, download installers, and file feedback against the
 * upstream repository, with no visible error:
 *
 *   1. apps/desktop/package.json  -> build.publish[0].owner/repo
 *      (electron-builder bakes this into app-update.yml, i.e. the installed
 *      app's update feed)
 *   2. apps/desktop/electron/main/updater.ts -> RELEASES_URL
 *      (manual "open releases" fallback, also allowlisted as an external URL)
 *   3. packages/shared/src/github-feedback.ts -> GITHUB_REPO
 *      (in-app bug-report URL)
 *
 * These assertions are the defence line: they fail as soon as one copy drifts
 * from the others, and every failure message names both sides so a post-rebase
 * break is located in one read. Upstream identity: vastsa/PI-Desktop.
 *
 * macOS release-signing identity is parameterized separately (repository
 * variables, unsigned by default) and is covered by ci-workflow.test.mjs.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const UPSTREAM = { owner: "vastsa", repo: "PI-Desktop" };

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [pkgSource, updaterSource, feedbackSource, releaseWorkflowSource] =
  await Promise.all([
    read("../package.json"),
    read("../electron/main/updater.ts"),
    read("../../../packages/shared/src/github-feedback.ts"),
    read("../../../.github/workflows/release.yml"),
  ]);

/** electron-builder publish feed: the owner/repo baked into app-update.yml. */
function parsePublishFeed() {
  const pkg = JSON.parse(pkgSource);
  const feed = pkg.build?.publish?.find(
    (entry) => entry?.provider === "github",
  );
  assert.ok(
    feed,
    "apps/desktop/package.json build.publish must declare a github provider entry",
  );
  assert.equal(
    typeof feed.owner,
    "string",
    "apps/desktop/package.json build.publish[0].owner must be a string",
  );
  assert.equal(
    typeof feed.repo,
    "string",
    "apps/desktop/package.json build.publish[0].repo must be a string",
  );
  return { owner: feed.owner, repo: feed.repo };
}

/** Updater's releases fallback URL, parsed as <owner>/<repo>. */
function parseReleasesUrl() {
  const literal = updaterSource.match(/RELEASES_URL\s*=\s*"([^"]+)"/);
  assert.ok(
    literal,
    "apps/desktop/electron/main/updater.ts must export RELEASES_URL as a plain string literal",
  );
  const url = new URL(literal[1]);
  assert.equal(
    url.origin,
    "https://github.com",
    `updater RELEASES_URL must stay a github.com release link: ${literal[1]}`,
  );
  const [owner, repo] = url.pathname.split("/").filter(Boolean);
  assert.ok(
    owner && repo,
    `updater RELEASES_URL must be https://github.com/<owner>/<repo>/releases/...: ${literal[1]}`,
  );
  return { owner, repo };
}

/** Shared in-app feedback repository, parsed from the "owner/repo" literal. */
function parseFeedbackRepo() {
  const literal = feedbackSource.match(/GITHUB_REPO\s*=\s*"([^"]+)"/);
  assert.ok(
    literal,
    "packages/shared/src/github-feedback.ts must export GITHUB_REPO as a plain string literal",
  );
  const [owner, repo] = literal[1].split("/");
  assert.ok(
    owner && repo,
    `packages/shared/src/github-feedback.ts GITHUB_REPO must be "<owner>/<repo>": ${literal[1]}`,
  );
  return { owner, repo };
}

const identityRows = [
  [
    "apps/desktop/package.json build.publish[0] (app-update.yml feed)",
    parsePublishFeed(),
  ],
  [
    "apps/desktop/electron/main/updater.ts RELEASES_URL (releases fallback)",
    parseReleasesUrl(),
  ],
  [
    "packages/shared/src/github-feedback.ts GITHUB_REPO (in-app feedback link)",
    parseFeedbackRepo(),
  ],
];

const asPair = (identity) => `${identity.owner}/${identity.repo}`;

test("the update feed, the updater URL, and the feedback link name the same repository", () => {
  for (let index = 1; index < identityRows.length; index += 1) {
    const [leftLabel, left] = identityRows[index - 1];
    const [rightLabel, right] = identityRows[index];
    assert.equal(
      asPair(right),
      asPair(left),
      `${rightLabel} points at ${asPair(right)}, but ${leftLabel} points at ${asPair(left)}`,
    );
  }
});

test("no identity path falls back to the upstream vastsa/PI-Desktop", () => {
  for (const [label, identity] of identityRows) {
    assert.notEqual(
      asPair(identity),
      `${UPSTREAM.owner}/${UPSTREAM.repo}`,
      `${label} still points at the upstream repository ${UPSTREAM.owner}/${UPSTREAM.repo}`,
    );
    assert.notEqual(
      identity.owner,
      UPSTREAM.owner,
      `${label} still uses the upstream owner "${UPSTREAM.owner}"; expected the fork owner`,
    );
  }
});

test("macOS release signing needs the fork's own repository variables", () => {
  // This fork has no Apple Developer account, so signing must stay opt-in and
  // must not carry an upstream team ID or certificate name.
  assert.match(
    releaseWorkflowSource,
    /MACOS_SIGN_RELEASE: \$\{\{ \(github\.event_name != 'workflow_dispatch' \|\| inputs\.sign_macos == true\) && vars\.MACOS_SIGNING == 'true' \}\}/,
    "release.yml must gate macOS signing on the MACOS_SIGNING repository variable (unsigned by default)",
  );
  assert.doesNotMatch(
    releaseWorkflowSource,
    /DUV63RKYTW/,
    "release.yml must not hard-code the upstream Apple team ID",
  );
  assert.match(
    releaseWorkflowSource,
    /CSC_NAME: \$\{\{ vars\.APPLE_SIGN_IDENTITY \}\}/,
    "release.yml must take the signing identity from APPLE_SIGN_IDENTITY, not a pinned name",
  );
});
