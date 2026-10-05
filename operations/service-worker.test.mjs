import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("./service-worker.js", import.meta.url), "utf8");

test("push notification click navigates the open staff app to the relevant enquiry", async () => {
  const handlers = new Map();
  const calls = [];
  const client = {
    url:"https://staff.example.test/operations/",
    async navigate(url) { calls.push(["navigate", url]); this.url = url; },
    async focus() { calls.push(["focus"]); }
  };
  const self = {
    registration:{ scope:"https://staff.example.test/operations/", showNotification:async () => {} },
    clients:{
      matchAll:async () => [client],
      openWindow:async url => calls.push(["open", url])
    },
    addEventListener(name, callback) { handlers.set(name, callback); }
  };
  vm.runInNewContext(source, { self, URL, Promise });

  let completion;
  handlers.get("notificationclick")({
    notification:{ data:{ url:"./?enquiry=123e4567-e89b-42d3-a456-426614174000" }, close() {} },
    waitUntil(value) { completion = value; }
  });
  await completion;

  assert.deepEqual(calls, [
    ["navigate", "https://staff.example.test/operations/?enquiry=123e4567-e89b-42d3-a456-426614174000"],
    ["focus"]
  ]);
});
