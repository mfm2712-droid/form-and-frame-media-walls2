import test from "node:test";
import assert from "node:assert/strict";
import { checkStaffAccess } from "./staff-access.mjs";

function client({ user = { id:"team-user" }, authError = null, role = "owner", profileError = null } = {}) {
  const queries = [];
  return {
    queries,
    auth:{ getUser:async () => ({ data:{ user }, error:authError }) },
    from(table) {
      queries.push(table);
      return { select:() => ({ eq:(column, value) => {
        assert.equal(column, "id");
        assert.equal(value, user.id);
        return { maybeSingle:async () => ({ data:role ? { role } : null, error:profileError }) };
      } }) };
    }
  };
}

test("only a verified user with an owner or staff profile can enter the desk", async () => {
  for (const role of ["owner", "staff"]) assert.deepEqual(await checkStaffAccess(client({ role })), { state:"authorized", role });
  for (const role of [null, "customer", "admin"]) assert.deepEqual(await checkStaffAccess(client({ role })), { state:"unassigned" });
});

test("signed-out and unverifiable sessions never query staff or business records", async () => {
  for (const options of [{ user:null }, { authError:new Error("Connection failed") }]) {
    const db = client(options);
    assert.equal((await checkStaffAccess(db)).state, options.authError ? "unavailable" : "signed_out");
    assert.deepEqual(db.queries, []);
  }
  const missingSession = client({ authError:{ name:"AuthSessionMissingError" } });
  assert.deepEqual(await checkStaffAccess(missingSession), { state:"signed_out" });
  assert.deepEqual(missingSession.queries, []);
});

test("a denied profile read or rejected network request fails closed rather than displaying an empty live desk", async () => {
  assert.deepEqual(await checkStaffAccess(client({ profileError:new Error("Read failed") })), { state:"unavailable" });
  assert.deepEqual(await checkStaffAccess({ auth:{ getUser:async () => { throw new Error("Network failed"); } } }), { state:"unavailable" });
});
