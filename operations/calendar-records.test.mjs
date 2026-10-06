import test from "node:test";
import assert from "node:assert/strict";
import { calendarWindow, loadCalendarRecords } from "./calendar-records.mjs";

function fixtureClient(records, { cap = 250, failTable = null, changedCount = false, repeatedPage = false } = {}) {
  return { from(table) {
    let start, end;
    return { select:() => ({
      lt(column, value) { assert.equal(column, "starts_at"); end = new Date(value); return this; },
      gt(column, value) { assert.equal(column, "ends_at"); start = new Date(value); return this; },
      order() { return this; },
      async range(offset, last) {
        if (table === failTable) return { data:null, error:new Error("Network failed"), count:null };
        const matches = records.filter(row => new Date(row.starts_at) < end && new Date(row.ends_at) > start);
        const from = repeatedPage && offset ? 0 : offset;
        return { data:matches.slice(from, from + Math.min(last - offset + 1, cap)), error:null, count:matches.length + (changedCount && offset ? 1 : 0) };
      }
    }) };
  } };
}

test("calendar windows include the full visible grid and local-day DST boundaries", () => {
  const month = calendarWindow(new Date(2026, 9, 5), "month");
  assert.equal(month.start.getDay(), 1);
  assert.equal(month.start.getDate(), 28);
  assert.equal(month.start.getMonth(), 8);
  assert.equal(month.end.getMonth(), 10);
  assert.equal(month.end.getDate(), 9);
  const week = calendarWindow(new Date(2026, 9, 25), "week");
  assert.equal(week.end.getTime() - week.start.getTime(), 169 * 60 * 60 * 1000);
  assert.equal(week.end.getHours(), 0);
});

test("selected periods include multi-day overlaps but exclude records touching only a boundary", async () => {
  const period = calendarWindow(new Date(2026, 9, 5), "week");
  const records = [
    { id:"spanning", starts_at:new Date(2026, 9, 4, 20).toISOString(), ends_at:new Date(2026, 9, 5, 8).toISOString() },
    { id:"ends-at-start", starts_at:new Date(2026, 9, 4).toISOString(), ends_at:period.start.toISOString() },
    { id:"starts-at-end", starts_at:period.end.toISOString(), ends_at:new Date(2026, 9, 13).toISOString() }
  ];
  const result = await loadCalendarRecords(fixtureClient(records), period);
  assert.deepEqual(result.appointments.map(row => row.id), ["spanning"]);
  assert.deepEqual(result.blocks.map(row => row.id), ["spanning"]);
});

test("paginates the whole period even when the server caps each page below the requested range", async () => {
  const period = calendarWindow(new Date(2026, 9, 5), "month");
  const records = Array.from({ length:601 }, (_, i) => ({ id:`appointment-${i}`, starts_at:new Date(2026, 9, 5, 9).toISOString(), ends_at:new Date(2026, 9, 5, 10).toISOString() }));
  const result = await loadCalendarRecords(fixtureClient(records, { cap:100 }), period);
  assert.equal(result.appointments.length, 601);
  assert.equal(new Set(result.appointments.map(row => row.id)).size, 601);
});

test("errors and shifting pagination never masquerade as an empty or complete calendar", async () => {
  const period = calendarWindow(new Date(2026, 9, 5), "month");
  const records = Array.from({ length:300 }, (_, i) => ({ id:`row-${i}`, starts_at:new Date(2026, 9, 5).toISOString(), ends_at:new Date(2026, 9, 6).toISOString() }));
  await assert.rejects(loadCalendarRecords(fixtureClient(records, { failTable:"appointments" }), period), /Network failed/);
  await assert.rejects(loadCalendarRecords(fixtureClient(records, { changedCount:true }), period), /changed while loading/);
  await assert.rejects(loadCalendarRecords(fixtureClient(records, { repeatedPage:true }), period), /changed while loading/);
});
