import { CATEGORIES, installSteps, timeAgo } from "./notification-centre.mjs";

const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" })[character]);

export function bellLabel(count) {
  return count > 0 ? `Notifications, ${count} unread` : "Notifications, none unread";
}

export function listHtml(items, now = new Date()) {
  if (!items.length) return `<p class="nc-empty">No notifications yet. New enquiries and job updates will appear here.</p>`;
  return `<ul class="nc-list">${items.map(item => `
    <li class="nc-item ${item.unread ? "unread" : ""}">
      <button type="button" class="nc-open" data-nc-open="${esc(item.id)}" data-nc-request="${esc(item.requestId || "")}" data-nc-view="${esc(item.view)}">
        <span class="nc-dot" aria-hidden="true"></span>
        <span class="nc-text"><b>${esc(item.title)}${item.unread ? ' <i class="nc-new">NEW</i>' : ""}</b><span>${esc(item.body)}</span>
        <small>${esc(timeAgo(item.createdAt, now))}${item.requestId ? " · Opens project" : ""}</small></span>
      </button>
      ${item.unread ? `<button type="button" class="nc-read" data-nc-read="${esc(item.id)}" aria-label="Mark as read: ${esc(item.title)}">Mark read</button>` : ""}
    </li>`).join("")}</ul>`;
}

export function preferencesHtml(prefs, { disabled = false } = {}) {
  return `<fieldset class="nc-prefs" ${disabled ? "disabled" : ""}><legend>Alert me about</legend>${CATEGORIES.map(category => `
    <label class="nc-pref"><input type="checkbox" data-nc-pref="${category.key}" ${prefs[category.key] ? "checked" : ""}>
    <span><b>${esc(category.label)}</b><small>${esc(category.hint)}</small></span></label>`).join("")}</fieldset>`;
}

export function deviceHtml(device, guideOptions, { canInstall = false } = {}) {
  const guide = installSteps(guideOptions);
  const action = device.action === "enable" ? `<button type="button" class="nc-primary" data-nc-device="enable">Enable notifications</button>`
    : device.action === "disable" ? `<button type="button" class="outline" data-nc-device="disable">Turn off on this device</button> <button type="button" class="outline" data-nc-device="test">Send test notification</button>`
    : "";
  return `<div class="nc-device"><p class="nc-state nc-${esc(device.key)}"><span>This device</span><b>${esc(device.label)}</b></p>
    <div class="nc-actions">${action}${canInstall ? `<button type="button" class="nc-primary" data-nc-device="install">Install app</button>` : ""}</div>
    <details class="nc-guide" ${device.key === "install" || device.key === "off" ? "open" : ""}><summary>How to install on ${esc(guide.title)}</summary><ol>${guide.steps.map(step => `<li>${esc(step)}</li>`).join("")}</ol></details>
    <p class="nc-privacy">Alerts show only the enquiry reference and a short status. Customer contact details and money amounts are never sent to your lock screen.</p></div>`;
}
