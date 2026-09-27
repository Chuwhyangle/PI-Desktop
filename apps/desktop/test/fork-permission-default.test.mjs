/**
 * Fork permission-default guard.
 *
 * Upstream resolves a permission mode that nobody set to `ask`, so every new
 * session stops for approval on its first Write/Edit/Bash. This fork resolves
 * the same chain — session override, then global `defaultPermissionMode`, then
 * the fallback — to `auto`, which is what lets a new session run unattended.
 *
 * The value is not cosmetic and not renderer-local: it lives in host-core, so
 * a rebase that restores upstream's `ask` silently puts the approval prompt
 * back, while a renderer-only edit would keep advertising a mode host-core does
 * not use. These assertions pin every copy to one value and name the file and
 * line when a rebase splits them apart again. Upstream value: `ask`, recorded
 * in decisions-log D115; the divergence itself is documented in FORK.md.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const FALLBACK = "auto";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const files = {
  permissionsTs: "../../../packages/shared/src/types/permissions.ts",
  sessionsRs: "../../../crates/host-core/src/sessions.rs",
  rpcRs: "../../../crates/host-core/src/rpc/mod.rs",
  collaborationRs:
    "../../../crates/host-core/src/session_collaboration/permissions.rs",
  composerTsx: "../src/components/Composer.tsx",
  settingsTsx: "../src/features/settings/SettingsPage.tsx",
  spec: "../../../docs/spec/03-runtime/03-tools-and-permissions.md",
  specZh: "../../../docs/zh-CN/spec/03-runtime/03-tools-and-permissions.md",
  forkDoc: "../../../FORK.md",
};

const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([name, path]) => [name, await read(path)]),
  ),
);

/** `file:line  text` for every line matching `pattern`. */
function locate(source, name, pattern) {
  return source
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter((entry) => pattern.test(entry.line))
    .map((entry) => `${name}:${entry.number}  ${entry.line}`);
}

test("the shared constant carries the fork fallback", () => {
  const match = sources.permissionsTs.match(
    /export const FALLBACK_PERMISSION_MODE: GlobalPermissionMode = "([^"]+)"/,
  );
  assert.ok(
    match,
    "packages/shared/src/types/permissions.ts must declare "
      + '`export const FALLBACK_PERMISSION_MODE: GlobalPermissionMode = "<mode>"`',
  );
  assert.equal(
    match[1],
    FALLBACK,
    `packages/shared/src/types/permissions.ts FALLBACK_PERMISSION_MODE is "${match[1]}"; `
      + `this fork resolves an unset permission mode to "${FALLBACK}"`,
  );
});

test("host-core declares the same fallback once", () => {
  const match = sources.sessionsRs.match(
    /pub const FALLBACK_PERMISSION_MODE: &str = "([^"]+)"/,
  );
  assert.ok(
    match,
    "crates/host-core/src/sessions.rs must declare "
      + '`pub const FALLBACK_PERMISSION_MODE: &str = "<mode>"`',
  );
  assert.equal(
    match[1],
    FALLBACK,
    `crates/host-core/src/sessions.rs FALLBACK_PERMISSION_MODE is "${match[1]}"; `
      + `ts side resolves to "${FALLBACK}"`,
  );
});

test("no host-core resolution point falls back to the upstream mode", () => {
  const offenders = [
    ...locate(
      sources.rpcRs,
      "crates/host-core/src/rpc/mod.rs",
      /unwrap_or_else\(\|\| "ask"/,
    ),
    ...locate(
      sources.collaborationRs,
      "crates/host-core/src/session_collaboration/permissions.rs",
      /unwrap_or_else\(\|\| "ask"/,
    ),
  ];
  assert.deepEqual(
    offenders,
    [],
    "these resolution points still hard-code the upstream fallback; use "
      + "`sessions::FALLBACK_PERMISSION_MODE` instead:\n"
      + offenders.join("\n"),
  );
  const rpcUses = locate(
    sources.rpcRs,
    "crates/host-core/src/rpc/mod.rs",
    /unwrap_or_else\(\|\| sessions::FALLBACK_PERMISSION_MODE/,
  );
  assert.equal(
    rpcUses.length,
    2,
    "crates/host-core/src/rpc/mod.rs must resolve the fallback in both "
      + `tools.execute and permissions.evaluate; found ${rpcUses.length}:\n`
      + rpcUses.join("\n"),
  );
  const collaborationUses = locate(
    sources.collaborationRs,
    "crates/host-core/src/session_collaboration/permissions.rs",
    /unwrap_or_else\(\|\| sessions::FALLBACK_PERMISSION_MODE/,
  );
  assert.equal(
    collaborationUses.length,
    1,
    "crates/host-core/src/session_collaboration/permissions.rs must resolve the "
      + `fallback for the collaboration ceiling; found ${collaborationUses.length}:`
      + `\n${collaborationUses.join("\n")}`,
  );
});

test("the renderer presents the same default", () => {
  const renderers = [
    ["apps/desktop/src/components/Composer.tsx", sources.composerTsx],
    ["apps/desktop/src/features/settings/SettingsPage.tsx", sources.settingsTsx],
  ];
  for (const [name, source] of renderers) {
    assert.match(
      source,
      /defaultPermissionMode \?\? FALLBACK_PERMISSION_MODE/,
      `${name} must read the shared fallback constant, not a local literal`,
    );
    assert.doesNotMatch(
      source,
      /defaultPermissionMode \?\? "ask"/,
      `${name} still falls back to "ask" locally; host-core would then run a `
        + "different mode than the UI presents",
    );
  }
});

test("the spec and FORK.md describe the fork fallback", () => {
  for (const [name, source] of [
    ["docs/spec/03-runtime/03-tools-and-permissions.md", sources.spec],
    [
      "docs/zh-CN/spec/03-runtime/03-tools-and-permissions.md",
      sources.specZh,
    ],
  ]) {
    assert.match(
      source,
      /FALLBACK_PERMISSION_MODE/,
      `${name} must name the fallback constant so the documented resolution `
        + "order matches host-core",
    );
  }
  const stale = locate(
    sources.spec,
    "docs/spec/03-runtime/03-tools-and-permissions.md",
    /^\|\s*`ask` \(default\)/,
  );
  assert.deepEqual(
    stale,
    [],
    "the spec still presents `ask` as the default mode:\n" + stale.join("\n"),
  );
  assert.match(
    sources.forkDoc,
    /permission/i,
    "FORK.md must record the permission-default divergence under Fork differences",
  );
});
