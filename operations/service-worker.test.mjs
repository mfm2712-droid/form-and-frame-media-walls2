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

function loadWorker({ windows = [], shown = [] } = {}) {
  const handlers = new Map(), calls = [];
  const self = {
    registration:{ scope:"https://staff.example.test/operations/", showNotification:async (title, options) => calls.push(["show", title, options]), getNotifications:async () => shown },
    clients:{ matchAll:async () => windows, openWindow:async url => calls.push(["open", url]) },
    navigator:{ setAppBadge:async count => calls.push(["badge", count]), clearAppBadge:async () => calls.push(["clear"]) },
    addEventListener(name, callback) { handlers.set(name, callback); }
  };
  vm.runInNewContext(source, { self, URL, Promise });
  return { handlers, calls };
}

test("a tap with the app closed opens the enquiry command centre, not the homepage", async () => {
  const { handlers, calls } = loadWorker();
  let done;
  handlers.get("notificationclick")({ notification:{ data:{ url:"./?enquiry=123e4567-e89b-42d3-a456-426614174000" }, close() {} }, waitUntil(value) { done = value; } });
  await done;
  assert.deepEqual(calls.filter(call => call[0] === "open"), [["open", "https://staff.example.test/operations/?enquiry=123e4567-e89b-42d3-a456-426614174000"]]);
});

test("a notification can never open a page outside the staff app", async () => {
  const { handlers, calls } = loadWorker();
  let done;
  handlers.get("notificationclick")({ notification:{ data:{ url:"https://attacker.example/phish" }, close() {} }, waitUntil(value) { done = value; } });
  await done;
  assert.deepEqual(calls.filter(call => call[0] === "open"), [["open", "https://staff.example.test/operations/"]]);
});

test("a push shows the generic text it was sent, with the FF status-bar badge and the brand logo, and nudges open windows", async () => {
  const messages = [];
  const { handlers, calls } = loadWorker({ shown:[{}], windows:[{ postMessage:message => messages.push(message) }] });
  let done;
  handlers.get("push")({ data:{ json:() => ({ title:"New Form & Frame enquiry", body:"Enquiry FF-261016-EA30 is ready to review.", tag:"enquiry-1", url:"./?enquiry=1" }) }, waitUntil(value) { done = value; } });
  await done;
  const shown = calls.find(call => call[0] === "show");
  assert.equal(shown[1], "New Form & Frame enquiry");
  assert.equal(shown[2].data.url, "./?enquiry=1");
  assert.equal(shown[2].tag, "enquiry-1");
  assert.match(shown[2].badge, /^\.\/notification-badge-ff\.png/);
  assert.equal(shown[2].icon, "./icon-192.png");
  assert.equal(calls.some(call => call[0] === "badge" || call[0] === "clear"), false, "the worker no longer touches the app-icon counter; the open window does");
  assert.equal(messages.length, 1); assert.equal(messages[0].type, "ff-push-received");
});
