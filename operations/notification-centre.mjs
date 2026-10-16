// Pure logic for the in-app notification centre. It reads the existing
// notification_events outbox, so there is no second notification system.

export const CATEGORIES = [
  { key:"new_enquiries", label:"New enquiries", hint:"A customer submits the website form." },
  { key:"quotations", label:"Quotations", hint:"A quotation is prepared, sent, rejected or expires." },
  { key:"acceptances", label:"Customer accepts", hint:"A customer accepts a quotation." },
  { key:"appointments", label:"Appointments", hint:"A survey or installation is booked, moved or cancelled." },
  { key:"jobs", label:"Job progress", hint:"A job is created, assigned, rescheduled or changes stage." },
  { key:"invoices_payments", label:"Invoices & payments", hint:"An invoice is sent or voided, or a payment is recorded." }
];
const KEYS = CATEGORIES.map(category => category.key);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalisePreferences(row) {
  const result = {};
  for (const key of KEYS) result[key] = row?.[key] !== false;
  return result;
}

export function describeNotification(event) {
  const payload = event?.payload || {};
  if (event?.event_type === "new_enquiry") {
    return {
      id:event.id, category:"new_enquiries", title:"New enquiry",
      body:payload.reference ? `Enquiry ${payload.reference} is ready to review.` : "A new enquiry is ready to review.",
      requestId:UUID.test(event.request_id || "") ? event.request_id : null,
      view:"work", createdAt:event.created_at
    };
  }
  return {
    id:event?.id, category:KEYS.includes(payload.category) ? payload.category : null,
    title:String(payload.title || "Update").slice(0, 80), body:String(payload.body || "").slice(0, 180),
    requestId:UUID.test(payload.request_id || "") ? payload.request_id : null,
    view:["today", "work", "calendar", "money"].includes(payload.view) ? payload.view : "today",
    createdAt:event?.created_at
  };
}

// Events that belong in this person's centre: push events only (so an enquiry
// is not listed once per channel), never their own actions, never a category
// they have switched off.
export function visibleNotifications(events, { userId = null, readIds = new Set(), preferences = {} } = {}) {
  const prefs = normalisePreferences(preferences);
  const seen = new Set();
  return (events || [])
    .filter(event => event && event.channel === "push" && ["new_enquiry", "workflow_update"].includes(event.event_type))
    .filter(event => !(userId && event.payload?.exclude_user_id === userId))
    .filter(event => { if (seen.has(event.id)) return false; seen.add(event.id); return true; })
    .map(describeNotification)
    .filter(item => !item.category || prefs[item.category])
    .map(item => ({ ...item, unread:!readIds.has(item.id) }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export const unreadCount = items => items.filter(item => item.unread).length;

export function timeAgo(value, now = new Date()) {
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return then.toLocaleDateString("en-GB", { day:"numeric", month:"short" });
}

export function unreadForRequest(items, requestId) {
  return items.filter(item => item.unread && item.requestId === requestId).map(item => item.id);
}

// Where is this device on the way to receiving alerts?
export function deviceState({ ios = false, installed = false, secure = true, supported = true, configured = true, permission = "default", registered = false } = {}) {
  if (!secure) return { key:"insecure", label:"Needs HTTPS", action:null };
  if (ios && !installed) return { key:"install", label:"Install to Home Screen first", action:"install" };
  if (!supported) return { key:"unsupported", label:"Browser not supported", action:null };
  if (!configured) return { key:"unconfigured", label:"Push service not configured", action:null };
  if (permission === "denied") return { key:"blocked", label:"Blocked in browser settings", action:null };
  if (registered && permission === "granted") return { key:"on", label:"On for this device", action:"disable" };
  return { key:"off", label:"Off for this device", action:"enable" };
}

export function installSteps({ ios = false, android = false, installed = false } = {}) {
  if (installed) return { title:"Installed", steps:["Operations is installed on this device. Use Enable notifications below to receive alerts."] };
  if (ios) return { title:"iPhone / iPad", steps:[
    "Open this page in Safari (not inside another app).",
    "Tap the Share button, then Add to Home Screen, then Add.",
    "Open Form & Frame from the new Home Screen icon.",
    "Sign in, then tap Enable notifications and choose Allow. (Needs iOS 16.4 or later.)"
  ] };
  if (android) return { title:"Android", steps:[
    "Open this page in Chrome.",
    "Tap Install app below (or menu ⋮, then Install app / Add to Home screen).",
    "Open Form & Frame from the new icon and sign in.",
    "Tap Enable notifications and choose Allow."
  ] };
  return { title:"Phone or computer", steps:[
    "iPhone: open in Safari, tap Share, then Add to Home Screen.",
    "Android: open in Chrome, then menu ⋮, then Install app.",
    "Open the installed app, sign in, then tap Enable notifications."
  ] };
}
