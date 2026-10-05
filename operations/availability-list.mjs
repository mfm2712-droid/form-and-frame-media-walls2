// Narrow-screen availability block list.
// The seven-column month/week grid stays intact, but on a 320–375px phone
// its in-cell "Remove" buttons can be narrower than 44px. The compact list
// below the grid repeats the current visible period's availability blocks
// with remove buttons that are at least 44 x 44px. Wider layouts hide the
// list, so they are unchanged.

export const MIN_TOUCH_TARGET_PX = 44;
export const LIST_HEADING = "Availability blocks in this period";
export const EMPTY_LIST_TEXT = "No availability blocks in this period.";
export const REMOVE_LABEL = "Remove";
export const UNTITLED_BLOCK_LABEL = "Untitled availability block";

const esc = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[character]));

const kindLabels = Object.freeze({ available:"Availability", blocked:"Blocked", holiday:"Holiday" });

// Availability blocks carry no appointment link or appointment flag, so
// scheduled and confirmed appointments are never offered for removal here.
export function isAvailabilityBlock(item) {
  if (!item || item.isAppointment === true || item.request_id != null) return false;
  return String(item.id ?? "").trim() !== "";
}

// Blocks that overlap any part of the visible period, including edges.
export function blocksInPeriod(blocks, periodStart, periodEnd) {
  const start = new Date(periodStart).getTime();
  const end = new Date(periodEnd).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  return (Array.isArray(blocks) ? blocks : [])
    .filter(isAvailabilityBlock)
    .filter(block => {
      const startsAt = new Date(block.starts_at).getTime();
      const endsAt = new Date(block.ends_at).getTime();
      return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= end && endsAt >= start;
    });
}

export function blockKindLabel(kind) {
  return kindLabels[kind] || "Availability block";
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday:"short", day:"numeric", month:"short" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { hour:"2-digit", minute:"2-digit" });

// A same-day block shows "Wed 14 Oct · 09:00–18:00"; a multi-day block
// shows "Wed 14 Oct 09:00 – Thu 15 Oct 18:00".
export function blockTimeRange(block) {
  const start = new Date(block.starts_at), end = new Date(block.ends_at);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return "";
  const startDay = dayFormat.format(start), endDay = dayFormat.format(end);
  return startDay === endDay
    ? `${startDay} · ${timeFormat.format(start)}–${timeFormat.format(end)}`
    : `${startDay} ${timeFormat.format(start)} – ${endDay} ${timeFormat.format(end)}`;
}

export function blockRowHtml(block) {
  const title = String(block.title ?? "").trim() || UNTITLED_BLOCK_LABEL;
  const when = blockTimeRange(block);
  const kind = blockKindLabel(block.kind);
  return `<li class="block-row"><div class="block-row-text"><b>${esc(title)}</b><span>${esc(kind)}${when ? ` · ${esc(when)}` : ""}</span></div><button type="button" class="unblock-list" data-id="${esc(block.id)}" aria-label="${esc(`Remove ${title}`)}">${esc(REMOVE_LABEL)}</button></li>`;
}

export function blockListHtml(blocks, periodStart, periodEnd) {
  const visible = blocksInPeriod(blocks, periodStart, periodEnd);
  if (!visible.length) return `<p class="block-list-empty">${esc(EMPTY_LIST_TEXT)}</p>`;
  return `<p class="block-list-heading">${esc(LIST_HEADING)}</p><ul class="block-list-rows">${visible.map(blockRowHtml).join("")}</ul>`;
}
