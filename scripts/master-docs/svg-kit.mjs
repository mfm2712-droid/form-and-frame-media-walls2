// Tiny dependency-free SVG diagram kit used by diagrams.mjs. Brand colours are
// the real tokens from index.html (:root light theme) and operations/styles.css.
export const C = { paper:"#E6E1D5", paper2:"#EEEADF", paper3:"#F4F1E8", frame:"#211F1A", ink:"#1E4D45", ink2:"#2E6A5E", oak:"#B4823F", pencil:"#7C766A", pencil2:"#B8B2A2", bad:"#9E3B2C", glow:"#D2892A" };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const KIND = {
  real:     { fill:C.ink,    stroke:C.ink,    text:"#F4F1E8", sub:"#CFE3DC", dash:"" },
  light:    { fill:C.paper3, stroke:C.ink,    text:C.frame,  sub:C.pencil,  dash:"" },
  external: { fill:C.paper2, stroke:C.pencil, text:C.frame,  sub:C.pencil,  dash:"" },
  planned:  { fill:"#FBF3E4", stroke:C.oak,    text:C.frame,  sub:C.oak,     dash:"6 4" },
  pr:       { fill:"#FBF3E4", stroke:C.glow,   text:C.frame,  sub:"#8A5A12", dash:"2 3" },
  broken:   { fill:"#F7E6E2", stroke:C.bad,    text:C.frame,  sub:C.bad,     dash:"" },
  data:     { fill:"#FFFFFF", stroke:C.ink2,   text:C.frame,  sub:C.pencil,  dash:"" }
};
export class Diagram {
  constructor(w, h, title) { this.w = w; this.h = h; this.title = title; this.parts = []; this.nodes = {}; this.edges = []; this.defs = ""; }
  group(x, y, w, h, label, kind = "light") {
    this.parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="none" stroke="${kind === "planned" ? C.oak : C.pencil2}" stroke-width="1.4" stroke-dasharray="${kind === "planned" ? "6 4" : "3 3"}"/><text x="${x + 12}" y="${y + 18}" font-family="IBM Plex Mono, monospace" font-size="11" letter-spacing="1.2" fill="${C.pencil}">${esc(label.toUpperCase())}</text>`);
    return this;
  }
  node(id, x, y, w, h, title, sub = "", kind = "light", opts = {}) {
    const k = KIND[kind]; this.nodes[id] = { x, y, w, h };
    const lines = String(title).split("\n"), subs = sub ? String(sub).split("\n") : [];
    const total = lines.length * 16 + subs.length * 13 + (subs.length ? 4 : 0);
    let ty = y + (h - total) / 2 + 13;
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${k.fill}" stroke="${k.stroke}" stroke-width="1.6" ${k.dash ? `stroke-dasharray="${k.dash}"` : ""}/>`;
    const anchor = opts.align === "left" ? "start" : "middle", tx = opts.align === "left" ? x + 12 : x + w / 2;
    const avail = w - 20;
    const tsize = Math.max(...lines.map(l => Math.min(14, avail / (l.length * 0.58))), 9);
    const ssize = subs.length ? Math.max(Math.min(10.5, avail / (Math.max(...subs.map(l => l.length)) * 0.62)), 8) : 10.5;
    for (const l of lines) { s += `<text x="${tx}" y="${ty}" text-anchor="${anchor}" font-family="Bricolage Grotesque, IBM Plex Sans, sans-serif" font-weight="700" font-size="${tsize.toFixed(1)}" fill="${k.text}">${esc(l)}</text>`; ty += 16; }
    if (subs.length) ty += 2;
    for (const l of subs) { s += `<text x="${tx}" y="${ty}" text-anchor="${anchor}" font-family="IBM Plex Mono, monospace" font-size="${ssize.toFixed(1)}" fill="${k.sub}">${esc(l)}</text>`; ty += 13; }
    if (opts.tag) s += `<text x="${x + w - 8}" y="${y - 5}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="9.5" letter-spacing="1" fill="${opts.tagColor || C.pencil}">${esc(opts.tag)}</text>`;
    this.parts.push(s); return this;
  }
  text(x, y, str, { size = 12, fill = C.frame, anchor = "start", mono = false, weight = 400 } = {}) {
    this.parts.push(`<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${mono ? "IBM Plex Mono, monospace" : "IBM Plex Sans, sans-serif"}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(str)}</text>`); return this;
  }
  point(id, side) { const n = this.nodes[id]; if (!n) throw new Error("unknown node " + id); return { l:[n.x, n.y + n.h / 2], r:[n.x + n.w, n.y + n.h / 2], t:[n.x + n.w / 2, n.y], b:[n.x + n.w / 2, n.y + n.h] }[side]; }
  edge(a, b, { from, to, label = "", kind = "real", via = null, lx = null, ly = null } = {}) {
    const A = this.nodes[a], B = this.nodes[b];
    if (!from || !to) { const dx = (B.x + B.w / 2) - (A.x + A.w / 2), dy = (B.y + B.h / 2) - (A.y + A.h / 2); if (Math.abs(dx) * 0.6 > Math.abs(dy)) { from = dx > 0 ? "r" : "l"; to = dx > 0 ? "l" : "r"; } else { from = dy > 0 ? "b" : "t"; to = dy > 0 ? "t" : "b"; } }
    const p1 = this.point(a, from), p2 = this.point(b, to); let pts = [p1];
    if (via) pts.push(...via); else {
      const h1 = from === "l" || from === "r", h2 = to === "l" || to === "r";
      if (h1 && h2 && p1[1] !== p2[1]) { const mx = (p1[0] + p2[0]) / 2; pts.push([mx, p1[1]], [mx, p2[1]]); }
      else if (!h1 && !h2 && p1[0] !== p2[0]) { const my = (p1[1] + p2[1]) / 2; pts.push([p1[0], my], [p2[0], my]); }
      else if (h1 && !h2 && p1[0] !== p2[0] && p1[1] !== p2[1]) pts.push([p2[0], p1[1]]);
      else if (!h1 && h2 && p1[0] !== p2[0] && p1[1] !== p2[1]) pts.push([p1[0], p2[1]]);
    }
    pts.push(p2);
    this.edges.push({ pts, label, kind, lx, ly }); return this;
  }
  render() {
    const dashed = k => k === "planned" ? `stroke="${C.oak}" stroke-dasharray="6 4"` : k === "pr" ? `stroke="${C.glow}" stroke-dasharray="2 3"` : k === "broken" ? `stroke="${C.bad}" stroke-dasharray="6 3"` : `stroke="${C.ink}"`;
    let e = "";
    for (const { pts, label, kind, lx, ly } of this.edges) {
      e += `<polyline points="${pts.map(p => p.join(",")).join(" ")}" fill="none" ${dashed(kind)} stroke-width="1.8" marker-end="url(#ah-${kind})"/>`;
      if (label) {
        let mx, my; if (lx != null) { mx = lx; my = ly; } else { let best = 0, bi = 0; for (let i = 0; i < pts.length - 1; i++) { const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); if (d > best) { best = d; bi = i; } } mx = (pts[bi][0] + pts[bi + 1][0]) / 2; my = (pts[bi][1] + pts[bi + 1][1]) / 2; }
        const wd = label.length * 6 + 10;
        e += `<rect x="${mx - wd / 2}" y="${my - 9}" width="${wd}" height="16" rx="3" fill="${C.paper}" opacity="0.95"/><text x="${mx}" y="${my + 3}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="10" fill="${C.frame}">${esc(label)}</text>`;
      }
    }
    const marker = (k, col) => `<marker id="ah-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${col}"/></marker>`;
    const defs = `<defs>${marker("real", C.ink)}${marker("planned", C.oak)}${marker("pr", C.glow)}${marker("broken", C.bad)}</defs>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.w} ${this.h}" width="${this.w}" height="${this.h}" role="img" aria-label="${esc(this.title)}"><rect width="${this.w}" height="${this.h}" fill="${C.paper}"/>${defs}<text x="18" y="26" font-family="Bricolage Grotesque, sans-serif" font-weight="800" font-size="17" fill="${C.frame}">${esc(this.title)}</text>${this.parts.join("")}${e}</svg>\n`;
  }
}
export function legend(d, x, y, items) {
  let cx = x; for (const [kind, label] of items) { const k = KIND[kind]; d.parts.push(`<rect x="${cx}" y="${y}" width="18" height="12" rx="2" fill="${k.fill}" stroke="${k.stroke}" stroke-width="1.4" ${k.dash ? `stroke-dasharray="${k.dash}"` : ""}/><text x="${cx + 24}" y="${y + 10}" font-family="IBM Plex Mono, monospace" font-size="10" fill="${C.frame}">${esc(label)}</text>`); cx += 36 + label.length * 6.3; }
}
export function sequence({ title, actors, steps, w = 1000, note = "" }) {
  const gap = (w - 60) / actors.length, top = 60, step = 38;
  const h = top + 50 + steps.length * step + 40;
  const x = i => 30 + gap * i + gap / 2;
  let s = "";
  actors.forEach((a, i) => {
    const kind = KIND[a.kind || "light"];
    s += `<rect x="${x(i) - 70}" y="${top - 22}" width="140" height="36" rx="4" fill="${kind.fill}" stroke="${kind.stroke}" stroke-width="1.6" ${kind.dash ? `stroke-dasharray="${kind.dash}"` : ""}/><text x="${x(i)}" y="${top - 1}" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-weight="700" font-size="13" fill="${kind.text}">${esc(a.name)}</text>`;
    s += `<line x1="${x(i)}" y1="${top + 14}" x2="${x(i)}" y2="${h - 24}" stroke="${C.pencil2}" stroke-width="1.2" stroke-dasharray="4 4"/>`;
  });
  steps.forEach((st, n) => {
    const y = top + 40 + n * step;
    if (st.note) { s += `<rect x="${x(st.at) - 95}" y="${y - 12}" width="190" height="24" rx="3" fill="#FBF3E4" stroke="${C.oak}"/><text x="${x(st.at)}" y="${y + 4}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="10" fill="${C.frame}">${esc(st.note)}</text>`; return; }
    const x1 = x(st.from), x2 = x(st.to), dashed = st.dashed || st.kind === "planned";
    const col = st.kind === "planned" ? C.oak : st.kind === "broken" ? C.bad : C.ink;
    if (st.from === st.to) { s += `<path d="M${x1} ${y - 8} h38 v16 h-38" fill="none" stroke="${col}" stroke-width="1.6" marker-end="url(#sq-${st.kind || "real"})"/><text x="${x1 + 46}" y="${y + 4}" font-family="IBM Plex Sans, sans-serif" font-size="11.5" fill="${C.frame}">${esc(st.text)}</text>`; return; }
    s += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${col}" stroke-width="1.7" ${dashed ? 'stroke-dasharray="6 4"' : ""} marker-end="url(#sq-${st.kind || "real"})"/>`;
    const mx = (x1 + x2) / 2, wd = Math.min(Math.abs(x2 - x1) - 10, st.text.length * 6.1 + 12);
    s += `<rect x="${mx - wd / 2}" y="${y - 19}" width="${wd}" height="15" rx="3" fill="${C.paper}"/><text x="${mx}" y="${y - 7}" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="11.5" fill="${C.frame}">${esc(st.text)}</text>`;
  });
  const mk = (k, c) => `<marker id="sq-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}"><rect width="${w}" height="${h}" fill="${C.paper}"/><defs>${mk("real", C.ink)}${mk("planned", C.oak)}${mk("broken", C.bad)}</defs><text x="18" y="24" font-family="Bricolage Grotesque, sans-serif" font-weight="800" font-size="17" fill="${C.frame}">${esc(title)}</text>${s}${note ? `<text x="18" y="${h - 8}" font-family="IBM Plex Mono, monospace" font-size="10" fill="${C.pencil}">${esc(note)}</text>` : ""}</svg>\n`;
}
