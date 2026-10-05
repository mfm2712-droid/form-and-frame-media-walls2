import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EMPTY_LIST_TEXT,
  LIST_HEADING,
  MIN_TOUCH_TARGET_PX,
  REMOVE_LABEL,
  UNTITLED_BLOCK_LABEL,
  blockKindLabel,
  blockListHtml,
  blockRowHtml,
  blockTimeRange,
  blocksInPeriod,
  isAvailabilityBlock
} from "./availability-list.mjs";

const block = (overrides = {}) => ({
  id: "b1",
  title: "HOLIDAY — family break",
  kind: "holiday",
  starts_at: "2026-10-14T08:00:00.000Z",
  ends_at: "2026-10-15T18:00:00.000Z",
  ...overrides
});

const period = {
  start: new Date("2026-10-01T00:00:00.000Z"),
  end: new Date("2026-10-31T23:59:59.999Z")
};

test("only availability blocks are listed, never appointments", () => {
  const rows = blocksInPeriod([
    block(),
    block({ id: "b2", starts_at: "2026-11-02T09:00:00.000Z", ends_at: "2026-11-02T10:00:00.000Z" }),
    block({ id: "b3", starts_at: "2026-09-30T09:00:00.000Z", ends_at: "2026-09-30T10:00:00.000Z" }),
    block({ id: "b4", isAppointment: true, request_id: "req-1" }),
    { id: "a1", request_id: "req-2", status: "scheduled", title: "Site survey", starts_at: "2026-10-14T09:00:00.000Z", ends_at: "2026-10-14T10:00:00.000Z" },
    { id: "a2", request_id: "req-3", status: "confirmed", title: "Installation", starts_at: "2026-10-14T09:00:00.000Z", ends_at: "2026-10-14T10:00:00.000Z" },
    { id: "   " },
    null
  ], period.start, period.end);
  assert.deepEqual(rows.map(item => item.id), ["b1"]);
});

test("blocks touching the period edges are included", () => {
  const rows = blocksInPeriod([
    block({ id: "edge-start", starts_at: "2026-10-11T00:00:00.000Z", ends_at: "2026-10-12T00:00:00.000Z" }),
    block({ id: "edge-end", starts_at: "2026-10-18T23:59:59.999Z", ends_at: "2026-10-19T00:00:00.000Z" }),
    block({ id: "after", starts_at: "2026-10-19T00:00:00.001Z", ends_at: "2026-10-20T00:00:00.000Z" })
  ], new Date("2026-10-12T00:00:00.000Z"), new Date("2026-10-18T23:59:59.999Z"));
  assert.deepEqual(rows.map(item => item.id), ["edge-start", "edge-end"]);
});

test("blocksInPeriod ignores invalid periods and malformed rows", () => {
  assert.deepEqual(blocksInPeriod([block()], "not a date", new Date()), []);
  assert.deepEqual(blocksInPeriod(null, new Date(), new Date()), []);
  assert.deepEqual(blocksInPeriod([block({ starts_at: "soon", ends_at: "later" })], new Date(), new Date()), []);
});

test("appointment rows are never treated as availability blocks", () => {
  assert.equal(isAvailabilityBlock(block()), true);
  assert.equal(isAvailabilityBlock({ ...block(), isAppointment: true }), false);
  assert.equal(isAvailabilityBlock({ ...block(), request_id: "req-1" }), false);
  assert.equal(isAvailabilityBlock({ title: "No id" }), false);
  assert.equal(isAvailabilityBlock(null), false);
});

test("block kinds are labelled in English", () => {
  assert.equal(blockKindLabel("holiday"), "Holiday");
  assert.equal(blockKindLabel("blocked"), "Blocked");
  assert.equal(blockKindLabel("available"), "Availability");
  assert.equal(blockKindLabel("survey"), "Availability block");
  assert.equal(blockKindLabel(undefined), "Availability block");
});

test("same-day blocks show one date and a time range", () => {
  const text = blockTimeRange(block({ starts_at: "2026-10-14T08:00:00.000Z", ends_at: "2026-10-14T17:30:00.000Z" }));
  assert.match(text, /^Wed 14 Oct · \d{2}:\d{2}–\d{2}:\d{2}$/);
});

test("multi-day blocks show both start and end", () => {
  assert.match(blockTimeRange(block()), /^Wed 14 Oct \d{2}:\d{2} – Thu 15 Oct \d{2}:\d{2}$/);
});

test("blocks with invalid dates show no time", () => {
  assert.equal(blockTimeRange(block({ starts_at: "soon", ends_at: "later" })), "");
});

test("block rows escape stored text and expose the block id", () => {
  const row = blockRowHtml(block({ id: 'b"1', title: '<b>Half & "term"</b>', starts_at: "soon", ends_at: "later" }));
  assert.ok(row.includes(`data-id="b&quot;1"`));
  assert.ok(row.includes(`aria-label="Remove &lt;b&gt;Half &amp; &quot;term&quot;&lt;/b&gt;"`));
  assert.ok(row.includes(`<b>&lt;b&gt;Half &amp; &quot;term&quot;&lt;/b&gt;</b>`));
  assert.ok(row.includes(`<span>Holiday</span>`));
  assert.ok(row.includes(`>${REMOVE_LABEL}<`));
  assert.ok(row.includes(`class="unblock-list"`));
});

test("blocks without a title get a neutral label", () => {
  const row = blockRowHtml(block({ title: "", starts_at: "soon", ends_at: "later" }));
  assert.ok(row.includes(`<b>${UNTITLED_BLOCK_LABEL}</b>`));
  assert.ok(row.includes(`aria-label="Remove ${UNTITLED_BLOCK_LABEL}"`));
});

test("the list names the period and lists each visible block", () => {
  const html = blockListHtml([
    block(),
    block({ id: "b2", title: "Workshop installation", kind: "blocked" })
  ], period.start, period.end);
  assert.ok(html.includes(`<p class="block-list-heading">${LIST_HEADING}</p>`));
  assert.ok(html.includes(`<ul class="block-list-rows">`));
  assert.ok(html.includes(`data-id="b1"`));
  assert.ok(html.includes(`data-id="b2"`));
  assert.equal((html.match(/class="block-row"/g) || []).length, 2);
});

test("the list reports when a period has no blocks", () => {
  assert.equal(blockListHtml([], period.start, period.end), `<p class="block-list-empty">${EMPTY_LIST_TEXT}</p>`);
  assert.equal(
    blockListHtml([block({ starts_at: "2026-11-02T09:00:00.000Z", ends_at: "2026-11-02T10:00:00.000Z" })], period.start, period.end),
    `<p class="block-list-empty">${EMPTY_LIST_TEXT}</p>`
  );
});

test("scheduled and confirmed appointments never appear in the block list", () => {
  const html = blockListHtml([
    block(),
    { id: "a1", request_id: "req-1", status: "scheduled", title: "Site survey", starts_at: "2026-10-14T09:00:00.000Z", ends_at: "2026-10-14T10:00:00.000Z" },
    { id: "a2", request_id: "req-2", status: "confirmed", title: "Installation", starts_at: "2026-10-14T09:00:00.000Z", ends_at: "2026-10-14T10:00:00.000Z" }
  ], period.start, period.end);
  assert.ok(html.includes(`data-id="b1"`));
  assert.ok(!html.includes(`data-id="a1"`));
  assert.ok(!html.includes(`data-id="a2"`));
  assert.ok(!html.includes("Site survey"));
});

// Responsive verification is source-only: no browser or device rendering was
// inspected. These checks read the stylesheet and confirm the list is hidden
// on wider layouts, revealed only for phones, and that every remove button
// is at least MIN_TOUCH_TARGET_PX in both dimensions.
test("narrow-screen styles give block removal a 44px touch target", async () => {
  assert.equal(MIN_TOUCH_TARGET_PX, 44);
  const css = await readFile(new URL("./styles.css", import.meta.url), "utf8");
  assert.ok(css.includes(".block-list-container{display:none"), "the block list must stay hidden on wider layouts");
  assert.ok(css.includes("@media(max-width:760px){.block-list-container{display:block}}"), "the block list must be revealed only on phone widths");
  assert.ok(
    css.includes(`.block-row .unblock-list{min-width:${MIN_TOUCH_TARGET_PX}px;min-height:${MIN_TOUCH_TARGET_PX}px`),
    "every remove button must be at least 44px wide and 44px tall"
  );
});
