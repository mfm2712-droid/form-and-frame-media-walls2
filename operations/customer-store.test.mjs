import assert from "node:assert/strict";
import test from "node:test";
import { canWriteCustomers, customerPayload, isCustomersTableMissing, loadCustomerRecords, mergeStoredCustomers, saveCustomerRecord } from "./customer-store.mjs";
import { deriveCustomers } from "./customers.mjs";
import { customerRecordHtml, customersHtml } from "./customers-view.mjs";

const esc = v => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const leads = [
  { id: "1", reference: "R1", customer_name: "Amelia Grant", email: "Amelia.Grant@example.test", phone: "07700 900123", postcode: "SL4 2HT", status: "new", created_at: "2026-10-01T10:00:00Z" },
  { id: "2", reference: "R2", customer_name: "Hugo Clarke", phone: "+44 7700 900441", postcode: "SL1 5QJ", status: "new", created_at: "2026-10-02T10:00:00Z" }
];
const derived = deriveCustomers(leads);

function fakeDb(handlers) {
  const calls = [];
  const db = { calls, from(table) {
    const state = { table, op: "select", args: null };
    const q = { select: () => { if (state.op === "select") state.op = "select"; return q; }, order: () => q, limit: () => q, eq: (...a) => { state.eq = a; return q; },
      insert: v => { state.op = "insert"; state.args = v; return q; }, update: v => { state.op = "update"; state.args = v; return q; },
      maybeSingle: async () => { calls.push({ ...state }); return handlers[state.op](state); },
      then: (a, b) => { calls.push({ ...state }); return Promise.resolve(handlers[state.op](state)).then(a, b); } };
    return q;
  } };
  return db;
}

test("only owners may write customer records (UI/helper gate; RLS is the real control)", () => {
  assert.equal(canWriteCustomers("owner"), true);
  for (const role of ["staff", "manager", null, undefined, "admin"]) assert.equal(canWriteCustomers(role), false);
});

test("missing table is recognised, so the app falls back to the derived list", async () => {
  for (const error of [{ code: "PGRST205" }, { code: "42P01" }, { status: 404 }]) assert.equal(isCustomersTableMissing(error), true);
  assert.equal(isCustomersTableMissing({ code: "42501" }), false);
  assert.equal(isCustomersTableMissing(null), false);
  assert.deepEqual(await loadCustomerRecords(fakeDb({ select: () => ({ data: null, error: { code: "PGRST205" } }) })), { available: false, rows: [], error: null });
  assert.deepEqual(await loadCustomerRecords({ from() { throw { code: "42P01" }; } }), { available: false, rows: [], error: null });
});

test("other load errors are reported (not hidden) and also fall back; success returns rows", async () => {
  const denied = await loadCustomerRecords(fakeDb({ select: () => ({ data: null, error: { code: "42501" } }) }));
  assert.equal(denied.available, false);
  assert.equal(denied.error.code, "42501");
  const ok = await loadCustomerRecords(fakeDb({ select: () => ({ data: [{ id: "c1" }], error: null }) }));
  assert.deepEqual([ok.available, ok.rows.length, ok.error], [true, 1, null]);
});

test("payload follows the database identity rule: lower-case email, normalised phone, trimmed notes", () => {
  const { payload } = customerPayload(derived.find(c => c.name === "Amelia Grant"), { notes: "  Prefers mornings  " });
  assert.deepEqual(payload, { full_name: "Amelia Grant", email: "amelia.grant@example.test", phone_normalised: "07700900123", postcode: "SL4 2HT", notes: "Prefers mornings" });
  assert.equal(customerPayload(derived[0], { fullName: "   " }).error, "A customer name is required.");
  assert.match(customerPayload(derived[0], { notes: "x".repeat(2001) }).error, /limited/);
  assert.equal(customerPayload(derived.find(c => c.name === "Hugo Clarke")).payload.phone_normalised, "07700900441");
});

test("merge: stored name/notes win, unmatched stored customers still show, derived-only stay unsaved", () => {
  const rows = [{ id: "c1", full_name: "Amelia Grant-Smith", email: "amelia.grant@example.test", phone_normalised: null, postcode: null, notes: "VIP" },
    { id: "c9", full_name: "Old Customer", email: "old@example.test", phone_normalised: null, notes: null, created_at: "2025-01-01T00:00:00Z" }];
  const merged = mergeStoredCustomers(derived, rows);
  const amelia = merged.find(c => c.emails.includes("amelia.grant@example.test"));
  assert.deepEqual([amelia.name, amelia.stored, amelia.notes, amelia.record.id], ["Amelia Grant-Smith", true, "VIP", "c1"]);
  assert.equal(merged.find(c => c.name === "Hugo Clarke").stored, false);
  const old = merged.find(c => c.key === "c:c9");
  assert.deepEqual([old.stored, old.enquiryCount, old.name], [true, 0, "Old Customer"]);
  assert.equal(merged.length, 3);
  assert.deepEqual(mergeStoredCustomers(derived, []).map(c => c.stored), [false, false], "no table rows: derived list unchanged");
});

test("owner insert and update; staff and manager are refused before any query", async () => {
  const db = fakeDb({ insert: () => ({ data: { id: "n1" }, error: null }), update: () => ({ data: { id: "c1" }, error: null }) });
  const [amelia] = mergeStoredCustomers(derived, []).filter(c => c.name === "Amelia Grant");
  assert.deepEqual(await saveCustomerRecord(db, "owner", amelia, { notes: "n" }), { saved: true });
  assert.equal(db.calls.at(-1).op, "insert");
  const saved = { ...amelia, record: { id: "c1" } };
  assert.deepEqual(await saveCustomerRecord(db, "owner", saved, { notes: "m" }), { saved: true });
  assert.deepEqual([db.calls.at(-1).op, db.calls.at(-1).eq], ["update", ["id", "c1"]]);
  const before = db.calls.length;
  for (const role of ["staff", "manager", null]) assert.match((await saveCustomerRecord(db, role, amelia, {})).error, /Only an owner/);
  assert.equal(db.calls.length, before, "no query issued for non-owners");
});

test("save failures are explained, never thrown: missing table, duplicate identity, RLS, zero rows, no identity", async () => {
  const [amelia] = mergeStoredCustomers(derived, []).filter(c => c.name === "Amelia Grant");
  const run = error => saveCustomerRecord(fakeDb({ insert: () => ({ data: null, error }) }), "owner", amelia, {});
  assert.equal((await run({ code: "PGRST205" })).unavailable, true);
  assert.match((await run({ code: "23505" })).error, /already uses/);
  assert.match((await run({ code: "42501" })).error, /Only an owner/);
  assert.match((await run({ code: "XX" })).error, /could not be saved/);
  assert.match((await saveCustomerRecord(fakeDb({ update: () => ({ data: null, error: null }) }), "owner", { ...amelia, record: { id: "c1" } }, {})).error, /not applied/);
  assert.match((await saveCustomerRecord({ from() { throw new Error("net"); } }, "owner", amelia, {})).error, /could not be saved/);
  const none = { name: "No contact", emails: [], phones: [], postcode: "" };
  assert.match((await saveCustomerRecord(fakeDb({}), "owner", none, {})).error, /no email or phone/);
});

test("view: no record controls without the table; staff read notes only; owners get the form; output is escaped", () => {
  const merged = mergeStoredCustomers(derived, [{ id: "c1", full_name: "Amelia <b>", email: "amelia.grant@example.test", notes: "<script>x</script>" }]);
  const plain = customersHtml(derived, { esc, moneyPence: String });
  assert.equal(/customer-record-form|SAVED RECORD/.test(plain), false, "fallback view is unchanged");
  const staff = customersHtml(merged, { esc, moneyPence: String, store: { available: true, canWrite: false } });
  assert.match(staff, /SAVED RECORD/); assert.match(staff, /Notes: &lt;script&gt;/);
  assert.equal(/customer-record-form/.test(staff), false);
  const owner = customersHtml(merged, { esc, moneyPence: String, store: { available: true, canWrite: true } });
  assert.equal(owner.split("customer-record-form").length - 1, 2, "one form per customer");
  assert.match(owner, /Edit saved record/); assert.match(owner, /Save to customer records/);
  assert.equal(owner.includes("<script>x"), false);
  assert.equal(customerRecordHtml({ stored: false, notes: "", name: "A", key: "k" }, { esc, canWrite: false }), "");
});
