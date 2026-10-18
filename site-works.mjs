// Sample ("illustrative") projects shown on the public page. FICTITIOUS, kept temporarily at Mark's request
// (decision of 18 Oct 2026). They are NOT real completed jobs and the page says so.
//
// REMOVING THEM IS ONE STEP: set SHOW_SAMPLE_WORKS to false (or delete this file's entries).
// With the flag off the build omits the whole section and does not copy assets/cases/ into dist/public.
// FF_SHOW_SAMPLE_WORKS=0|1 may override the flag for one build (used by the tests); the file value is the default.
// Details below are copied verbatim from docs/pending-mark/works-section.html.txt; nothing has been added.
export const SHOW_SAMPLE_WORKS = true;

export const SAMPLE_WORKS = Object.freeze([
  { place: "BURNHAM · 4.2 M WALL", spec: '65" recessed TV · oak library wings · linear fire · warm LED', before: "assets/cases/burnham-library-before.webp", after: "assets/cases/burnham-library-after.webp" },
  { place: "LANGLEY · CHIMNEY BREAST", spec: '55" flush TV · microcement chimney · smoked oak alcove joinery', before: "assets/cases/langley-chimney-before.webp", after: "assets/cases/langley-chimney-after.webp" },
  { place: "SLOUGH · FULL-WIDTH CINEMA WALL", spec: '75" recessed TV · charcoal cabinetry · bronze display · 1.5 m fire', before: "assets/cases/slough-cinema-before.webp", after: "assets/cases/slough-cinema-after.webp" },
  { place: "WINDSOR · COMPACT TOWNHOUSE", spec: '55" TV recess · pale ash storage · floating shelf · halo LED', before: "assets/cases/windsor-compact-before.webp", after: "assets/cases/windsor-compact-after.webp" }
]);

export function sampleWorksEnabled(env = {}) {
  const override = (env.FF_SHOW_SAMPLE_WORKS ?? "").toString().trim();
  if (override === "0" || override.toLowerCase() === "false") return false;
  if (override === "1" || override.toLowerCase() === "true") return true;
  return SHOW_SAMPLE_WORKS;
}
