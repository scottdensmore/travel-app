import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const guard = fileURLToPath(new URL("../deploy/postgres-layout-guard.sh", import.meta.url));
const checkWith = (allowNew, ...args) => spawnSync("/bin/sh", [guard, "--check-layout", ...args], {
  encoding: "utf8",
  env: { PATH: "/usr/bin:/bin", TRAVEL_POSTGRES_ALLOW_NEW_CLUSTER: allowNew ? "true" : "false" },
});
const check = (...args) => checkWith(false, ...args);

function volume(files, run) {
  const root = mkdtempSync(join(tmpdir(), "travel-pg-layout-"));
  try {
    for (const [relative, content] of files) {
      const path = join(root, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    run(root);
    for (const [relative, content] of files) {
      assert.equal(readFileSync(join(root, relative), "utf8"), content, "checks must preserve fixture data");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("refuses silent initialization of an empty volume", () => volume([], (root) => {
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to silently initialize/);
  assert.equal(existsSync(join(root, "18")), false);
}));

test("allows an explicitly confirmed new empty volume without creating data", () => volume([], (root) => {
  const result = checkWith(true, root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(existsSync(join(root, "18")), false);
}));

test("accepts the PostgreSQL 18 version-specific layout", () => volume([
  ["18/docker/PG_VERSION", "18\n"], ["18/docker/base/fixture", "synthetic database bytes"],
], (root) => assert.equal(check(root).status, 0)));

test("refuses legacy cluster files at the volume root", () => volume([
  ["PG_VERSION", "15\n"], ["base/fixture", "synthetic database bytes"],
], (root) => {
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Legacy PostgreSQL data layout detected/);
  assert.match(result.stderr, /Preserve the existing volume/);
  assert.equal(existsSync(join(root, "18")), false);
}));

test("refuses the pre-18 data subdirectory layout", () => volume([
  ["data/PG_VERSION", "15\n"], ["data/base/fixture", "synthetic database bytes"],
], (root) => assert.equal(check(root).status, 1)));

test("refuses a mixed legacy and PostgreSQL 18 volume", () => volume([
  ["PG_VERSION", "15\n"], ["18/docker/PG_VERSION", "18\n"],
], (root) => assert.equal(check(root).status, 1)));

test("quotes paths containing spaces", () => volume([
  ["old cluster/PG_VERSION", "15\n"],
], (root) => assert.equal(check(join(root, "old cluster")).status, 1)));

test("rejects missing roots without creating them", () => volume([], (root) => {
  const missing = join(root, "missing");
  assert.equal(check(missing).status, 1);
  assert.equal(existsSync(missing), false);
}));

test("requires exactly one root in read-only check mode", () => {
  assert.equal(check().status, 64);
  assert.equal(check("one", "two").status, 64);
});

test("new-cluster opt-in cannot bypass legacy data", () => volume([
  ["PG_VERSION", "15\n"],
], (root) => assert.equal(checkWith(true, root).status, 1)));

test("refuses a mismatched database version under the target path", () => volume([
  ["18/docker/PG_VERSION", "15\n"],
], (root) => assert.equal(check(root).status, 1)));

test("refuses unrecognized volume contents even with new-cluster opt-in", () => volume([
  ["unexpected-file", "synthetic data"],
], (root) => assert.equal(checkWith(true, root).status, 1)));

test("refuses incomplete target layouts without a version marker", () => volume([
  ["18/docker/base/fixture", "synthetic database bytes"],
], (root) => assert.equal(checkWith(true, root).status, 1)));
