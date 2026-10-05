import test from "node:test";
import assert from "node:assert/strict";
import { buildFinanceSummary, buildProjectModel } from "./project-model.mjs";

test("real enquiry model uses the configurator's TV field and exposes no invented costs", () => {
  const enquiry = {
    customer_name: "Fictional Customer",
    postcode: "SL1 1AA",
    wall_width: "4.2 m",
    guide_low: 5_560,
    guide_high: 6_640,
    project_spec: { tv: "75", finish: "walnut" }
  };
  const project = buildProjectModel(enquiry);
  assert.match(project.geometry, /75″ TV/);
  assert.equal(project.sampleCosts, false);
  assert.equal("materialsCost" in project, false);
  assert.deepEqual(buildFinanceSummary(enquiry, project), { mode: "guide", low: 5_560, high: 6_640 });
});

test("fictional cost figures are shown only for explicitly marked demo projects", () => {
  const enquiry = { guide_low: 5_560, guide_high: 6_640 };
  const project = { sampleCosts: true, materialsCost: 2_000, equipmentCost: 1_000, labourCost: 2_000, total: 5_000 };
  assert.deepEqual(buildFinanceSummary(enquiry, project), {
    mode: "sample", materials: 2_000, equipment: 1_000, labour: 2_000, total: 5_000
  });
  assert.equal(buildFinanceSummary(enquiry, { sampleCosts: false, total: 5_000 }).mode, "guide");
});
