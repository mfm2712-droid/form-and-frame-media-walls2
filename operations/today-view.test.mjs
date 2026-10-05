import test from "node:test";
import assert from "node:assert/strict";
import { getTodayAgenda } from "./today-view.mjs";

test("today agenda includes only today's enquiries and overlapping requested visit windows", () => {
  const now = new Date(2026, 9, 4, 12);
  const items = [
    { id: "new-today", created_at: new Date(2026, 9, 4, 9).toISOString(), status: "new" },
    { id: "older", created_at: new Date(2026, 9, 3, 23, 59).toISOString(), status: "reviewing" },
    { id: "visit-today", created_at: new Date(2026, 8, 20).toISOString(), status: "date_requested", preferred_start: new Date(2026, 9, 4, 16).toISOString(), preferred_end: new Date(2026, 9, 4, 18).toISOString() },
    { id: "window-overlap", status: "confirmed", preferred_start: new Date(2026, 9, 3, 23).toISOString(), preferred_end: new Date(2026, 9, 4, 2).toISOString() },
    { id: "not-a-visit", status: "reviewing", preferred_start: new Date(2026, 9, 4, 10).toISOString(), preferred_end: new Date(2026, 9, 4, 11).toISOString() },
    { id: "tomorrow", status: "date_requested", preferred_start: new Date(2026, 9, 5, 9).toISOString(), preferred_end: new Date(2026, 9, 5, 10).toISOString() },
    { id: "incomplete-window", status: "date_requested", preferred_start: new Date(2026, 9, 4, 9).toISOString() }
  ];

  const agenda = getTodayAgenda(items, now);
  assert.deepEqual(agenda.todayNewEnquiries.map(item => item.id), ["new-today"]);
  assert.deepEqual(agenda.todayVisitWindows.map(item => item.id), ["window-overlap", "visit-today"]);
});

test("today agenda handles an empty list and invalid dates", () => {
  assert.deepEqual(getTodayAgenda([], new Date(2026, 9, 4)), { todayNewEnquiries: [], todayVisitWindows: [] });
  assert.deepEqual(getTodayAgenda([{ id: "invalid", created_at: "bad-date", status: "date_requested", preferred_start: "bad-date", preferred_end: "bad-date" }], new Date(2026, 9, 4)), { todayNewEnquiries: [], todayVisitWindows: [] });
});
