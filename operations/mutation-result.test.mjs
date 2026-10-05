import test from "node:test";
import assert from "node:assert/strict";
import { requirePersistedRow } from "./mutation-result.mjs";

test("requires a returned row before reporting a database change as saved", () => {
  const row = { id:"request-1" };
  assert.equal(requirePersistedRow({ data:row, error:null }), row);
  assert.throws(() => requirePersistedRow({ data:null, error:null }), /did not confirm/);
  assert.throws(() => requirePersistedRow({ data:[], error:null }), /did not confirm/);
});

test("preserves the database error when a change is rejected", () => {
  const error = new Error("permission denied");
  assert.throws(() => requirePersistedRow({ data:null, error }), thrown => thrown === error);
});
