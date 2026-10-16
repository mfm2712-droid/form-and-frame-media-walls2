import test from "node:test";
import assert from "node:assert/strict";
import { visibleNotifications, unreadCount, unreadForRequest, normalisePreferences, describeNotification, timeAgo, deviceState, installSteps, CATEGORIES } from "./notification-centre.mjs";
import { listHtml, preferencesHtml, deviceHtml, bellLabel } from "./notification-view.mjs";

const R1 = "123e4567-e89b-42d3-a456-426614174000", R2 = "223e4567-e89b-42d3-a456-426614174000";
const ME = "323e4567-e89b-42d3-a456-426614174000";
const events = [
  { id:"e1", channel:"push", event_type:"new_enquiry", request_id:R1, payload:{ reference:"FF-261016-EA30" }, created_at:"2026-10-16T09:00:00Z" },
  { id:"e1-mail", channel:"email", event_type:"new_enquiry", request_id:R1, payload:{}, created_at:"2026-10-16T09:00:01Z" },
  { id:"e2", channel:"push", event_type:"workflow_update", request_id:null, payload:{ title:"Quotation sent", body:"FF-261016-EA30 · A quotation was recorded as sent.", view:"work", category:"quotations", request_id:R1 }, created_at:"2026-10-16T09:30:00Z" },
  { id:"e3", channel:"push", event_type:"workflow_update", request_id:null, payload:{ title:"Payment recorded", body:"x", view:"money", category:"invoices_payments", request_id:R2, exclude_user_id:ME }, created_at:"2026-10-16T09:40:00Z" },
  { id:"e4", channel:"push", event_type:"workflow_update", request_id:null, payload:{ title:"Visit booked", body:"y", view:"calendar", category:"appointments", request_id:R2 }, created_at:"2026-10-16T09:50:00Z" }
];

test("lists one entry per push event, newest first, without email duplicates or the viewer's own actions", () => {
  const items = visibleNotifications(events, { userId:ME });
  assert.deepEqual(items.map(item => item.id), ["e4", "e2", "e1"]);
  assert.equal(items.find(item => item.id === "e1").requestId, R1);
  assert.equal(items.find(item => item.id === "e1").body, "Enquiry FF-261016-EA30 is ready to review.");
});

test("tracks unread state per person and hides categories they switched off", () => {
  const items = visibleNotifications(events, { userId:ME, readIds:new Set(["e1"]), preferences:{ appointments:false } });
  assert.deepEqual(items.map(item => item.id), ["e2", "e1"]);
  assert.equal(unreadCount(items), 1);
  assert.deepEqual(unreadForRequest(items, R1), ["e2"]);
});

test("missing preference rows mean everything is on", () => {
  assert.deepEqual(Object.values(normalisePreferences(null)), CATEGORIES.map(() => true));
  assert.equal(normalisePreferences({ jobs:false }).jobs, false);
});

test("ignores malformed ids and unknown categories instead of trusting them", () => {
  const item = describeNotification({ id:"x", event_type:"workflow_update", payload:{ title:"T", body:"B", category:"evil", request_id:"../x", view:"https://evil.test" }, created_at:"2026-10-16T09:00:00Z" });
  assert.equal(item.requestId, null); assert.equal(item.category, null); assert.equal(item.view, "today");
});

test("formats relative times", () => {
  const now = new Date("2026-10-16T10:00:00Z");
  assert.equal(timeAgo("2026-10-16T09:59:40Z", now), "just now");
  assert.equal(timeAgo("2026-10-16T09:30:00Z", now), "30 min ago");
  assert.equal(timeAgo("2026-10-16T07:00:00Z", now), "3 hr ago");
  assert.equal(timeAgo("2026-10-14T10:00:00Z", now), "2 days ago");
});

test("describes the device state on the way to receiving alerts", () => {
  assert.equal(deviceState({ ios:true, installed:false }).key, "install");
  assert.equal(deviceState({ secure:false }).key, "insecure");
  assert.equal(deviceState({ configured:false }).key, "unconfigured");
  assert.equal(deviceState({ permission:"denied" }).key, "blocked");
  assert.equal(deviceState({ permission:"granted", registered:true }).key, "on");
  assert.equal(deviceState({}).action, "enable");
  assert.match(installSteps({ ios:true }).steps.join(" "), /Add to Home Screen/);
  assert.match(installSteps({ android:true }).steps.join(" "), /Install app/);
});

test("renders escaped notification rows with unread markers, mark-read and project links", () => {
  const html = listHtml([{ id:"a", title:"<b>x</b>", body:"Body", requestId:R1, view:"work", unread:true, createdAt:"2026-10-16T09:00:00Z" }], new Date("2026-10-16T10:00:00Z"));
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(html, /data-nc-request="123e4567/);
  assert.match(html, /Mark read/);
  assert.match(html, /Opens project/);
  assert.match(listHtml([]), /No notifications yet/);
  assert.equal(bellLabel(3), "Notifications, 3 unread");
});

test("renders category switches, install guide and the privacy promise", () => {
  const prefs = preferencesHtml(normalisePreferences({ jobs:false }));
  assert.equal((prefs.match(/data-nc-pref=/g) || []).length, 6);
  assert.match(prefs, /data-nc-pref="jobs" >/);
  const device = deviceHtml(deviceState({}), { ios:true }, { canInstall:false });
  assert.match(device, /Enable notifications/);
  assert.match(device, /never sent to your lock screen/);
});
