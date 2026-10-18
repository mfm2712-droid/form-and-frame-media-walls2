// Renders the "Sample projects" section for the public page (see site-works.mjs).
// Source index.html carries only the marker <!--FF:WORKS-->; the build replaces it with this section,
// or with nothing when the flag is off.
export const WORKS_MARKER = "<!--FF:WORKS-->";
export const SAMPLE_LABEL = "Sample project";
export const SAMPLE_INTRO = "These projects are illustrative samples, not real completed jobs.";

const esc = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function renderWorksSection(works, enabled) {
  if (!enabled || !works || works.length === 0) return "";
  const cards = works.map(work => `        <article class="work"><div class="case-split" role="img" aria-label="${esc(SAMPLE_LABEL)}: before and after illustration, ${esc(work.place)}" style="background-image:url('${esc(work.before)}')"><div class="case-before" style="background-image:url('${esc(work.after)}')"></div><span class="case-label before">BEFORE</span><span class="case-label after">AFTER</span><div class="case-line"></div><span class="sample-tag">${SAMPLE_LABEL}</span></div><div class="wc"><em class="sample-note">${SAMPLE_LABEL}</em><b>${esc(work.place)}</b><span>${esc(work.spec)}</span></div></article>`).join("\n");
  return `<section class="plate" id="works" data-sample-works="true">
    <div class="wrap">
      <div class="plate-head">
        <div class="eyebrow">Sample projects</div>
        <h2>Recent drawings, off the wall and into rooms.</h2>
        <p class="works-intro">${SAMPLE_INTRO}</p>
      </div>
      <div class="works" id="rWorks">
${cards}
      </div>
    </div>
  </section>`;
}
