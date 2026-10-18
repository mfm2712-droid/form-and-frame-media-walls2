import assert from "node:assert/strict";
import test from "node:test";
import { allocateDocumentNumber, insertWithNumber, isFunctionMissing, localDocumentNumber } from "./document-number.mjs";

const rpcMissing = { code: "PGRST202", message: "Could not find the function public.allocate_document_number", status: 404 };

function fakeDb({ rpc, insert }) {
  const calls = { rpc: [], insert: [] };
  return {
    calls,
    rpc: async (name, args) => { calls.rpc.push([name, args]); return rpc(calls.rpc.length); },
    from: table => ({ insert: row => { calls.insert.push([table, row]); const r = insert(calls.insert.length, row); return { select: () => ({ single: async () => r }) }; } })
  };
}

test("local numbers keep the previous prefix-date-suffix shape", () => {
  const n = localDocumentNumber("invoice", new Date("2026-10-17T10:00:00Z"), () => "abcdef");
  assert.equal(n, "FFI-20261017-ABCD");
  assert.match(localDocumentNumber("quote"), /^FFQ-\d{8}-[0-9A-F]{4}$/);
  assert.match(localDocumentNumber("work_order"), /^FFJ-\d{8}-[0-9A-F]{4}$/);
  assert.throws(() => localDocumentNumber("payment"));
});

test("function-missing detection only matches 'not found' signals", () => {
  assert.equal(isFunctionMissing(rpcMissing), true);
  assert.equal(isFunctionMissing({ code: "42883" }), true);
  assert.equal(isFunctionMissing({ code: "42501", message: "permission denied" }), false);
  assert.equal(isFunctionMissing(new Error("network")), false);
  assert.equal(isFunctionMissing(null), false);
});

test("without the migration the app falls back to a local number and stops calling the RPC", async () => {
  const db = fakeDb({ rpc: () => ({ data: null, error: rpcMissing }), insert: () => ({ data: { id: "1" }, error: null }) });
  const state = {};
  const a = await allocateDocumentNumber(db, "quote", state);
  const b = await allocateDocumentNumber(db, "quote", state);
  assert.equal(a.source, "local");
  assert.equal(b.source, "local");
  assert.equal(db.calls.rpc.length, 1, "RPC is probed once, then cached as unsupported");
  assert.equal(state.serverSupported, false);
});

test("with the migration the server number is used and no local number is generated", async () => {
  const db = fakeDb({ rpc: () => ({ data: "FFI-000042", error: null }), insert: () => ({ data: { id: "1" }, error: null }) });
  const state = {};
  const res = await insertWithNumber(db, "invoice", () => ({ work_order_id: "w" }), state);
  assert.equal(res.data.id, "1");
  assert.deepEqual(db.calls.insert[0], ["invoices", { work_order_id: "w", invoice_number: "FFI-000042" }]);
  assert.equal(state.serverSupported, true);
});

test("permission or network errors from the RPC are surfaced, never hidden by a local fallback", async () => {
  const db = fakeDb({ rpc: () => ({ data: null, error: { code: "42501", message: "Only team members can allocate document numbers." } }), insert: () => assert.fail("must not insert") });
  await assert.rejects(() => allocateDocumentNumber(db, "quote", {}), error => error.code === "42501");
  assert.equal(db.calls.insert.length, 0);
});

test("an unexpected server number is rejected", async () => {
  const db = fakeDb({ rpc: () => ({ data: "FFI-1", error: null }), insert: () => assert.fail("must not insert") });
  await assert.rejects(() => allocateDocumentNumber(db, "invoice", {}), /unexpected/);
  const wrongKind = fakeDb({ rpc: () => ({ data: "FFQ-000001", error: null }), insert: () => assert.fail("must not insert") });
  await assert.rejects(() => allocateDocumentNumber(wrongKind, "invoice", {}), /unexpected/);
});

test("local fallback retries a number collision with a fresh number, bounded", async () => {
  const collision = { code: "23505", message: 'duplicate key value violates unique constraint "quotes_quote_number_key"' };
  const ids = ["aaaa", "bbbb", "cccc"];
  let i = 0;
  const db = fakeDb({
    rpc: () => ({ data: null, error: rpcMissing }),
    insert: n => n <= 2 ? { data: null, error: collision } : { data: { id: "ok" }, error: null }
  });
  const res = await insertWithNumber(db, "quote", () => ({ request_id: "r" }), {}, { randomId: () => ids[i++] });
  assert.equal(res.data.id, "ok");
  const used = db.calls.insert.map(([, row]) => row.quote_number);
  assert.equal(new Set(used).size, 3, "each attempt used a different number");

  const always = fakeDb({ rpc: () => ({ data: null, error: rpcMissing }), insert: () => ({ data: null, error: collision }) });
  const failed = await insertWithNumber(always, "quote", () => ({}), {});
  assert.equal(failed.error, collision);
  assert.equal(always.calls.insert.length, 3);
});

test("other unique violations (e.g. quote version) and server numbers are not retried", async () => {
  const version = { code: "23505", message: 'duplicate key value violates unique constraint "quotes_request_id_version_key"' };
  const db = fakeDb({ rpc: () => ({ data: null, error: rpcMissing }), insert: () => ({ data: null, error: version }) });
  const res = await insertWithNumber(db, "quote", () => ({}), {});
  assert.equal(res.error, version);
  assert.equal(db.calls.insert.length, 1);
  const server = fakeDb({ rpc: () => ({ data: "FFQ-000001", error: null }), insert: () => ({ data: null, error: { code: "23505", message: "quote_number" } }) });
  await insertWithNumber(server, "quote", () => ({}), {});
  assert.equal(server.calls.insert.length, 1);
});
