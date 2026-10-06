import test from "node:test";
import assert from "node:assert/strict";
import { FORM_AND_FRAME_SUPABASE_REF, resolvePublicConfig } from "./public-config.mjs";

const url = `https://${FORM_AND_FRAME_SUPABASE_REF}.supabase.co`;
const fixtureKey = (claims) => `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.fictionalSignature`;
const key = fixtureKey({ role:"anon", ref:FORM_AND_FRAME_SUPABASE_REF });

test("allows an unconfigured local build but never a disconnected production build", () => {
  assert.deepEqual(resolvePublicConfig({}), { supabaseUrl: "", supabaseAnonKey: "", vapidPublicKey: "" });
  assert.throws(() => resolvePublicConfig({ VERCEL_ENV: "production" }), /require both public Supabase/);
});

test("requires the public URL and key as a pair", () => {
  assert.throws(() => resolvePublicConfig({ FF_PUBLIC_SUPABASE_URL: url }), /Set both/);
  assert.throws(() => resolvePublicConfig({ FF_PUBLIC_SUPABASE_ANON_KEY: key }), /Set both/);
});

test("rejects malformed URLs and every Supabase project except Form & Frame", () => {
  assert.throws(() => resolvePublicConfig({ FF_PUBLIC_SUPABASE_URL: "http://invalid", FF_PUBLIC_SUPABASE_ANON_KEY: key }), /standard HTTPS/);
  assert.throws(() => resolvePublicConfig({ FF_PUBLIC_SUPABASE_URL: "https://lumi-settings.supabase.co", FF_PUBLIC_SUPABASE_ANON_KEY: key }), /different Supabase project/);
});

test("accepts and normalizes the dedicated project in production", () => {
  assert.deepEqual(resolvePublicConfig({
    VERCEL_ENV: "production",
    FF_PUBLIC_SUPABASE_URL: `${url}/`,
    FF_PUBLIC_SUPABASE_ANON_KEY: key
  }), { supabaseUrl: url, supabaseAnonKey: key, vapidPublicKey: "" });
});

test("accepts only the browser-safe P-256 VAPID public key format", () => {
  const publicKey = `B${"A".repeat(86)}`;
  assert.equal(resolvePublicConfig({ FF_OPERATIONS_VAPID_PUBLIC_KEY:publicKey }).vapidPublicKey, publicKey);
  assert.throws(() => resolvePublicConfig({ FF_OPERATIONS_VAPID_PUBLIC_KEY:"private-key" }), /valid uncompressed P-256 public key/);
});

test("blocks privileged credentials and foreign-project anon keys before public serialization", () => {
  for (const unsafe of [
    fixtureKey({ role:"service_role", ref:FORM_AND_FRAME_SUPABASE_REF }),
    fixtureKey({ role:"authenticated", ref:FORM_AND_FRAME_SUPABASE_REF }),
    fixtureKey({ role:"anon", ref:"another-project" }),
    fixtureKey(null),
    "sb_secret_fictional",
    "sb_publishable_fictional",
    "invalid-key"
  ]) {
    assert.throws(() => resolvePublicConfig({ FF_PUBLIC_SUPABASE_URL:url, FF_PUBLIC_SUPABASE_ANON_KEY:unsafe }), /public anon|public anon JWT/);
  }
});
