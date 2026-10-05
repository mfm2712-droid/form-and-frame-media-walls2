export function buildProjectModel(lead) {
  if (lead.project) return lead.project;
  const spec = lead.project_spec || {};
  const tv = spec.tv ? `${spec.tv}″ TV` : "TV specification pending";
  return {
    title: `${lead.customer_name || "Customer"}'s media wall`,
    location: lead.postcode || "Survey location pending",
    image: "../assets/cases/burnham-library-after.webp",
    geometry: `${lead.wall_width || "Measured survey pending"} · ${tv}`,
    system: spec.finish || "Bespoke fitted joinery — confirm finish at survey",
    materials: ["#8b6243", "#173d33", "#cba35d"],
    materialLabel: "Oak, matte lacquer and aged brass palette",
    sampleCosts: false
  };
}

export function buildFinanceSummary(lead, project) {
  if (project.sampleCosts === true) {
    return {
      mode: "sample",
      materials: Number(project.materialsCost || 0),
      equipment: Number(project.equipmentCost || 0),
      labour: Number(project.labourCost || 0),
      total: Number(project.total || 0)
    };
  }
  return {
    mode: "guide",
    low: Number(lead.guide_low || 0),
    high: Number(lead.guide_high || 0)
  };
}
