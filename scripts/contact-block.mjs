// Config-ready contact block for the public footer (FRAME-005).
// Source index.html carries only the marker <!--FF:CONTACT-->. At build time it is replaced by
// renderContactBlock(). Contact details are TO BE SUPPLIED BY MARK (business phone/email are being
// configured on 19 Oct 2026): until FF_CONTACT_PHONE / FF_CONTACT_EMAIL are set in the build
// environment nothing is published and the block only points at the survey form. Nothing is invented.
export const CONTACT_MARKER = "<!--FF:CONTACT-->";

const esc = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function parseContact(env = {}) {
  const phone = (env.FF_CONTACT_PHONE || "").trim();
  const email = (env.FF_CONTACT_EMAIL || "").trim();
  if (phone && !/^\+?[0-9][0-9 ()-]{6,18}[0-9]$/.test(phone)) throw new Error("FF_CONTACT_PHONE is not a plausible phone number.");
  if (email && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) throw new Error("FF_CONTACT_EMAIL is not a plausible email address.");
  return { phone: phone || null, email: email || null };
}

export function renderContactBlock(contact = {}) {
  const lines = ['<a href="#request">Request a survey</a>'];
  if (contact.phone) lines.push(`<a href="tel:${esc(contact.phone.replace(/[^+0-9]/g, ""))}">${esc(contact.phone)}</a>`);
  if (contact.email) lines.push(`<a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a>`);
  return `<span class="foot-contact" aria-label="Contact"><b>Enquiries</b>${lines.join("")}</span>`;
}
