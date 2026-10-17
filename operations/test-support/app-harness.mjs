// Test harness: boots the real operations/app.js against a fake DOM and a mocked Supabase client.
// Nothing here touches the network, a real Supabase project or any credential.
// The only transformation of app.js is replacing its first-line `createClient` import with an injected mock.
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const operationsDir = new URL("../", import.meta.url);

function makeElement(registry, key) {
  const listeners = new Map();
  const base = {
    __key: key, hidden: false, disabled: false, textContent: "", innerHTML: "", value: "", dataset: {}, style: {}, children: [],
    elements: new Proxy({}, { get: (target, name) => (target[name] ??= { value: "" }) }),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler); },
    removeEventListener() {},
    async fire(type, extra = {}) {
      const event = { type, target: proxy, currentTarget: proxy, preventDefault() {}, stopPropagation() {}, submitter: null, ...extra };
      for (const handler of listeners.get(type) || []) await handler(event);
    },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, focus() {}, blur() {}, click() { return proxy.fire("click"); },
    querySelector: selector => registry.get(`${key}>${selector}`), querySelectorAll: () => [],
    closest: () => null, matches: () => false, contains: () => false, append() {}, appendChild() {}, remove() {}, scrollIntoView() {},
    get parentElement() { return registry.get(`${key}^parent`); },
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }), isConnected: true
  };
  const proxy = new Proxy(base, {
    get(target, name) { if (name in target) return target[name]; if (typeof name === "symbol") return undefined; return undefined; },
    set(target, name, value) { target[name] = value; return true; }
  });
  return proxy;
}

export async function bootStaffApp({ config, client, search = "", clientFactory } = {}) {
  const elements = new Map();
  // Mirror the real markup's initial `hidden` state so visibility assertions are meaningful.
  const html = await readFile(new URL("index.html", operationsDir), "utf8");
  const initiallyHidden = new Set([...html.matchAll(/<[a-z0-9]+\b[^>]*\bid="([^"]+)"[^>]*>/gi)].filter(match => /\shidden(?=[\s>=])/.test(match[0])).map(match => `#${match[1]}`));
  const registry = { get(key) { if (!elements.has(key)) { const element = makeElement(registry, key); if (initiallyHidden.has(key)) element.hidden = true; elements.set(key, element); } return elements.get(key); } };
  const calls = { createClient: [], reload: 0, errors: [] };
  const document = {
    getElementById: id => registry.get(`#${id}`),
    querySelector: selector => registry.get(selector),
    querySelectorAll: () => [],
    createElement: tag => makeElement(registry, `new:${tag}`),
    addEventListener() {}, removeEventListener() {},
    body: makeElement(registry, "body"), documentElement: makeElement(registry, "html"),
    visibilityState: "visible", hidden: false, title: "", cookie: ""
  };
  const location = { href: `https://ops.example.test/operations/${search}`, search, hash: "", origin: "https://ops.example.test", pathname: "/operations/", reload() { calls.reload++; }, replace() {} };
  const windowObject = { FF_OPERATIONS_CONFIG: config, location, addEventListener() {}, removeEventListener() {}, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), open: () => null };
  const saved = {};
  const define = (name, value) => { saved[name] = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  define("window", windowObject);
  define("document", document);
  define("HTMLFormElement", class HTMLFormElement {});
  define("HTMLElement", class HTMLElement {});
  define("location", location);
  define("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  define("sessionStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  define("navigator", { userAgent: "node-test", serviceWorker: undefined, onLine: true });
  define("MutationObserver", class { observe() {} disconnect() {} });
  define("Notification", undefined);
  define("PushManager", undefined);
  define("__ffCreateClient", (...args) => { calls.createClient.push(args); return (clientFactory || (() => client))(...args); });
  const originalError = console.error;
  console.error = (...args) => { calls.errors.push(args.map(String).join(" ")); };

  const dir = await mkdtemp(join(tmpdir(), "ff-app-"));
  try {
    for (const name of await readdir(operationsDir)) {
      if (name.endsWith(".mjs") && !name.endsWith(".test.mjs")) await cp(new URL(name, operationsDir), join(dir, name));
    }
    const original = await readFile(new URL("app.js", operationsDir), "utf8");
    const transformed = original.replace(/^import \{ createClient \} from "[^"]+";/, "const createClient = globalThis.__ffCreateClient;");
    if (transformed === original) throw new Error("operations/app.js no longer starts with the expected createClient import");
    await writeFile(join(dir, "app.js"), transformed);
    await import(`${pathToFileURL(join(dir, "app.js")).href}?boot=${Math.random()}`);
    await settle();
  } catch (error) {
    await restore();
    throw error;
  }
  async function settle() { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); }
  async function restore() {
    console.error = originalError;
    for (const [name, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    await rm(dir, { recursive: true, force: true });
  }
  return { $: id => document.getElementById(id), calls, location, settle, restore };
}

// Minimal mocked supabase-js client. Every table query is recorded; the data returned is configurable.
export function mockClient({ session = null, sessionError = null, user = null, userError = null, role = null, profileError = null, otpError = null, otpRejects = null, tables = {} } = {}) {
  const log = { otp: [], signOut: 0, queries: [], getSession: 0, getUser: 0, removedChannels: 0 };
  const chain = (table, result) => {
    const q = { select: () => q, eq: () => q, gte: () => q, lte: () => q, lt: () => q, gt: () => q, in: () => q, is: () => q, not: () => q, or: () => q, order: () => q, limit: () => q, range: () => q,
      insert: () => q, update: () => q, delete: () => q, upsert: () => q, single: async () => result, maybeSingle: async () => result, then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
    return q;
  };
  const channel = { on() { return channel; }, subscribe() { return channel; }, unsubscribe() {} };
  return {
    log,
    auth: {
      getSession: async () => { log.getSession++; return { data: { session }, error: sessionError }; },
      getUser: async () => { log.getUser++; return { data: { user }, error: userError }; },
      signInWithOtp: async arg => { log.otp.push(arg); if (otpRejects) throw otpRejects; return { data: {}, error: otpError }; },
      signOut: async () => { log.signOut++; return { error: null }; },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    from(table) {
      log.queries.push(table);
      if (table === "profiles") return chain(table, { data: role ? { role } : null, error: profileError });
      return chain(table, tables[table] || { data: [], error: null });
    },
    channel: () => channel,
    removeChannel: async () => { log.removedChannels++; },
    rpc: async () => ({ data: null, error: null })
  };
}
