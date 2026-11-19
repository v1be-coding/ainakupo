import assert from "node:assert/strict";
import { test } from "node:test";
import { projectsFor } from "../projects.ts";

const names = (target: string | undefined) => projectsFor(target).map((p) => p.name);
const project = (target: string | undefined, name: string) => projectsFor(target).find((p) => p.name === name);

test("a branch runs smoke, then acceptance, then the rate-limit check, then the per-key limit check", () => {
  assert.deepEqual(names("branch"), ["smoke", "acceptance", "rate-limit", "key-limit"]);
  assert.deepEqual(project("branch", "rate-limit")?.dependencies, ["smoke", "acceptance"]);
  assert.deepEqual(project("branch", "key-limit")?.dependencies, ["rate-limit"]);
});

test("the per-key limit check runs only in its own project", () => {
  const keyLimit = /key-limit\.spec\.ts/;
  assert.deepEqual(project("branch", "acceptance")?.testIgnore, keyLimit);
  assert.deepEqual(project("branch", "key-limit")?.testMatch, keyLimit);
});

test("an unset target, as in a local run, counts as a branch", () => {
  assert.deepEqual(names(undefined), ["smoke", "acceptance", "rate-limit", "key-limit"]);
});

test("production leaves acceptance tests and the per-key limit check out (Q29)", () => {
  assert.deepEqual(names("production"), ["smoke", "rate-limit"]);
  assert.deepEqual(projectsFor("production").at(-1)?.dependencies, ["smoke"]);
});
