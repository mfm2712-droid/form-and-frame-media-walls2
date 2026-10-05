import test from "node:test";
import assert from "node:assert/strict";
import { isIOSDevice, isInstalledPWA, pushSetupMessage } from "./push-support.mjs";

test("detects iPhone, iPad and modern iPadOS desktop user agents", () => {
  assert.equal(isIOSDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }), true);
  assert.equal(isIOSDevice({ userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)" }), true);
  assert.equal(isIOSDevice({ platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(isIOSDevice({ platform: "MacIntel", maxTouchPoints: 1 }), false);
});

test("recognises standalone iOS and browser PWA display modes", () => {
  assert.equal(isInstalledPWA({ displayModeStandalone: true }), true);
  assert.equal(isInstalledPWA({ navigatorStandalone: true }), true);
  assert.equal(isInstalledPWA({}), false);
});

test("gives iPhone users the Home Screen installation steps before generic setup guidance", () => {
  assert.match(pushSetupMessage({ ios:true, installed:false, configured:false }), /Safari, tap Share → Add to Home Screen/);
  assert.match(pushSetupMessage({ ios:true, installed:false }), /16\.4 or later/);
  assert.match(pushSetupMessage({ ios:true, installed:true, configured:false }), /private delivery service/);
});

test("explains the HTTPS, capability and server-configuration requirements", () => {
  assert.match(pushSetupMessage({ secure:false }), /HTTPS/);
  assert.match(pushSetupMessage({ supported:false }), /does not support/);
  assert.equal(pushSetupMessage({ configured:true }), "");
});
