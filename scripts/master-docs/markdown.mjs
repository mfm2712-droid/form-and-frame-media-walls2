// Small dependency-free Markdown converter for the Master Book sources. Supports only what those sources use:
// headings, paragraphs, flat lists, tables, fenced code, images (as figures), links, bold, italics, inline code,
// ::: callout blocks, [[STATUS]] badges and E-nn evidence markers.
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const slug = s => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[`*_]/g, "").replace(/&amp;/g, "and").replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-");
const STATUS = ["IMPLEMENTED", "VERIFIED", "PARTIAL", "BROKEN", "PLANNED", "NOT IMPLEMENTED", "BLOCKED"];

const matrixClass = (c, k) => k === 0 ? "" : /^none/.test(c) ? "m-no" : /not |view|drafts only|decision/.test(c) ? "m-part" : "m-yes";

export function makeConverter({ chapterOfFile, ids }) {
  const usedIds = ids;
  const links = []; // every internal href, checked after the whole book is assembled
  const toc = [];   // headings per chapter

  function inline(text, { noEvidence = false } = {}) {
    const hold = [];
    const put = html => { hold.push(html); return `\u0000${hold.length - 1}\u0000`; };
    let s = text;
    s = s.replace(/`([^`]+)`/g, (_, c) => put(`<code>${esc(c)}</code>`));
    s = s.replace(/\[\[([A-Z ]+)\]\]/g, (m, k) => STATUS.includes(k) ? put(`<span class="badge s-${k.toLowerCase().replace(/ /g, "-")}">${k}</span>`) : m);
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => put(`<img src="${src}" alt="${alt}">`));
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
      if (/^https?:\/\//.test(url)) return put(`<a href="${url}" target="_blank" rel="noopener noreferrer" class="ext">${label}</a>`);
      let href = url;
      const m = url.match(/^([A-Za-z0-9_.-]+\.md)(#.+)?$/);
      if (m) { const ch = chapterOfFile(m[1]); if (!ch) throw new Error(`Link to unknown chapter file ${url}`); href = m[2] || `#${ch}`; }
      if (href.startsWith("#")) links.push(href.slice(1));
      return put(`<a href="${href}">${label}</a>`);
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:]|$)/g, "$1<em>$2</em>");
    if (!noEvidence) s = s.replace(/\bE-(\d\d)\b/g, (m, n) => { links.push(`E-${n}`); return `<a class="ev" href="#E-${n}">E-${n}</a>`; });
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => hold[+i]);
  }

  function splitRow(line) {
    const cells = []; let cur = "", tick = false;
    const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === "`") tick = !tick;
      if (ch === "|" && !tick && body[i - 1] !== "\\") { cells.push(cur); cur = ""; } else cur += ch;
    }
    cells.push(cur);
    return cells.map(c => c.trim().replace(/\\\|/g, "|"));
  }

  function uniqueId(base) { let id = base || "section", n = 2; while (usedIds.has(id)) id = `${base}-${n++}`; usedIds.add(id); return id; }

  function convert(src, ctx) {
    const lines = src.replace(/\r/g, "").split("\n");
    const out = [];
    const blocks = []; // plain-text blocks for the search index: {hid, text}
    let curH = { id: ctx.chapterId, text: ctx.title };
    const addText = t => { const x = t.replace(/\s+/g, " ").trim(); if (x) blocks.push({ hid: curH.id, h: curH.text, t: x }); };
    let i = 0, para = [];
    const flush = () => {
      if (!para.length) return;
      const t = para.join(" ");
      const img = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (img) {
        const [, alt, srcp] = img;
        const kind = /diagrams\/.+\.svg$/.test(srcp) ? "diagram" : /full-/.test(srcp) ? "tall" : "shot";
        out.push(`<figure class="fig ${kind}"><img class="zoomable" src="${srcp}" alt="${esc(alt)}" loading="lazy"><figcaption>${inline(alt)}</figcaption></figure>`);
        addText(alt);
      } else { out.push(`<p>${inline(t)}</p>`); addText(t); }
      para = [];
    };
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        flush(); const buf = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++; out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`); addText(buf.join(" ")); continue;
      }
      let m;
      if ((m = line.match(/^::: ?(\w+)\s*$/))) {
        flush(); const name = m[1]; const buf = []; i++;
        while (i < lines.length && !/^:::\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++;
        if (name === "swatches") {
          const chips = buf.filter(l => l.includes("|")).map(l => { const [n, hex, d] = l.split("|").map(x => x.trim()); return `<div class="swatch"><span class="chip" style="background:${hex}"></span><b>${esc(n)}</b><code>${esc(hex)}</code><small>${esc(d || "")}</small></div>`; });
          out.push(`<div class="swatches">${chips.join("")}</div>`); addText(buf.join(" "));
        } else {
          const sub = name === "matrix" ? { ...ctx, cellClass: matrixClass } : ctx;
          const inner = convert(buf.join("\n"), { ...sub, nested: true });
          out.push(`<div class="callout ${name}">${inner.html}</div>`);
          inner.blocks.forEach(b => blocks.push(b));
        }
        continue;
      }
      if (/^<a id="[^"]+"><\/a>\s*$/.test(line)) { flush(); const id = line.match(/id="([^"]+)"/)[1]; usedIds.add(id); out.push(line.trim()); i++; continue; }
      if ((m = line.match(/^(#{1,4}) (.+)$/))) {
        flush();
        const level = m[1].length; const raw = m[2].trim();
        const plain = raw.replace(/`/g, "");
        const id = level === 1 ? ctx.chapterId : uniqueId(slug(plain));
        if (level === 1) usedIds.add(id);
        curH = { id, text: plain };
        if (!ctx.nested) toc.push({ chapter: ctx.chapterId, level, id, text: plain });
        out.push(`<h${level} id="${id}">${inline(raw, { noEvidence: true })}</h${level}>`);
        i++; continue;
      }
      if (/^\s*-{3,}\s*$/.test(line)) { flush(); out.push("<hr>"); i++; continue; }
      if (/^\|/.test(line) && /^\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
        flush();
        const head = splitRow(line); i += 2; const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) rows.push(splitRow(lines[i++]));
        const th = head.map(c => `<th>${inline(c)}</th>`).join("");
        const tb = rows.map(r => `<tr>${r.map((c, k) => {
          const evId = ctx.evidence && k === 0 && /^E-\d\d$/.test(c) ? ` id="${c}"` : "";
          if (evId) usedIds.add(c);
          return `<td${evId}${ctx.cellClass ? ` class="${ctx.cellClass(c, k)}"` : ""}>${evId ? esc(c) : inline(c)}</td>`;
        }).join("")}</tr>`).join("");
        out.push(`<div class="tablewrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`);
        addText([head.join(" "), ...rows.map(r => r.join(" "))].join(" ; ").replace(/\[\[|\]\]/g, ""));
        continue;
      }
      if (/^\s*([-*]|\d+\.) /.test(line)) {
        flush(); const ordered = /^\s*\d+\./.test(line); const items = [];
        while (i < lines.length && (/^\s*([-*]|\d+\.) /.test(lines[i]) || (/^\s+\S/.test(lines[i]) && items.length))) {
          if (/^\s*([-*]|\d+\.) /.test(lines[i])) items.push(lines[i].replace(/^\s*([-*]|\d+\.) /, "")); else items[items.length - 1] += " " + lines[i].trim();
          i++;
        }
        out.push(`<${ordered ? "ol" : "ul"}>${items.map(t => `<li>${inline(t)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
        items.forEach(addText); continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      para.push(line.trim()); i++;
    }
    flush();
    return { html: out.join("\n"), blocks };
  }
  return { convert, links, toc, usedIds, inline };
}
