// MOCKED Supabase network layer (clearly not the real service). Intercepts every request to the
// fictional origin, records it, and answers from in-memory fixtures. Used with the REAL app code and
// the REAL vendored supabase-js running in a real browser.
import { FICTIONAL_ORIGIN } from "./env.mjs";

const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
export const USER = { id: "00000000-0000-4000-8000-0000000000a1", email: "owner@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
export function fictionalSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access_token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, role: "authenticated", exp, email: USER.email })}.fictional-signature`;
  return { access_token, refresh_token: "fictional-refresh", token_type: "bearer", expires_in: 3600, expires_at: exp, user: USER };
}
export const storageKey = "sb-otqzhocismdjbvvsjnpe-auth-token";

export async function installMock(page, { role = "owner", tables = {}, otpResponse = null, rpc = {}, enquiryResponse = null } = {}) {
  const requests = [];
  const db = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, structuredClone(rows)]));
  const state = { role, db, requests };
  await page.setRequestInterception(true);
  page.on("request", async request => {
    const url = new URL(request.url());
    if (url.origin !== FICTIONAL_ORIGIN) {
      if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(request.url())) return request.continue();
      return request.abort(); // fonts/CDNs/anything else: blocked, E2E is offline-safe
    }
    const body = request.postData() ? (() => { try { return JSON.parse(request.postData()); } catch { return request.postData(); } })() : null;
    const record = { method: request.method(), path: url.pathname, search: url.search, body };
    requests.push(record);
    const json = (status, data, headers = {}) => request.respond({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*", ...headers }, body: JSON.stringify(data) });
    if (request.method() === "OPTIONS") return json(204, {});
    if (url.pathname === "/auth/v1/user") return json(200, USER);
    if (url.pathname === "/auth/v1/otp") return otpResponse ? json(otpResponse.status, otpResponse.body) : json(200, {});
    if (url.pathname === "/auth/v1/logout") return json(204, {});
    if (url.pathname.startsWith("/auth/v1/")) return json(200, {});
    if (url.pathname === "/functions/v1/submit-enquiry") return enquiryResponse ? json(enquiryResponse.status, enquiryResponse.body) : json(200, { reference: "FF-E2E-0001" });
    if (url.pathname.startsWith("/rest/v1/rpc/")) { const name = url.pathname.split("/").pop(); const handler = rpc[name]; return handler ? json(200, handler(body, record)) : json(200, null); }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.split("/").pop();
      const single = /vnd\.pgrst\.object/.test(request.headers().accept || "");
      const wantsRepresentation = /return=representation/.test(request.headers().prefer || "");
      if (table === "profiles") { const rows = [{ id: USER.id, role: state.role, full_name: "E2E Owner", email: USER.email }]; return json(200, single ? rows[0] : rows); }
      const rows = state.db[table] || [];
      if (request.method() === "GET" || request.method() === "HEAD") {
        const id = url.searchParams.get("id")?.replace(/^eq\./, "");
        const selected = id ? rows.filter(row => row.id === id) : rows;
        return json(200, single ? (selected[0] ?? null) : selected, { "content-range": `0-${Math.max(selected.length - 1, 0)}/${selected.length}` });
      }
      if (request.method() === "POST") { const created = (Array.isArray(body) ? body : [body]).map((row, index) => ({ id: `new-${table}-${rows.length + index + 1}`, ...row })); state.db[table] = [...rows, ...created]; return json(201, single ? created[0] : created); }
      if (request.method() === "PATCH") { const id = url.searchParams.get("id")?.replace(/^eq\./, ""); const target = rows.find(row => row.id === id); if (target) Object.assign(target, body); return json(200, wantsRepresentation || single ? (single ? (target ?? null) : (target ? [target] : [])) : []); }
      if (request.method() === "DELETE") return json(200, []);
    }
    return json(404, { message: "unmocked" });
  });
  return state;
}

export async function seedSession(page) {
  await page.evaluateOnNewDocument((key, value) => { try { localStorage.setItem(key, value); } catch { /* ignore */ } }, storageKey, JSON.stringify(fictionalSession()));
}
