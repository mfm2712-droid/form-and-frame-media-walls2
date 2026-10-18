// Screenshots of the built staff app with MOCKED Supabase and FICTIONAL data (same harness as the E2E tests).
import { startSuite, fictionalLeads, fictionalMoney, fictionalNotifications, numberingRpc } from "./lib/fixture.mjs";
import { waitFor } from "./lib/env.mjs";
const out = process.argv[2];
const suite = await startSuite();
for (const [role, w, h, mobile] of [["owner", 1280, 900, false], ["owner", 390, 844, true], ["staff", 1280, 900, false]]) {
  const { page } = await suite.page({ width: w, height: h, mobile, session: true, mock: { role, tables: { consultation_requests: fictionalLeads(), ...fictionalMoney(), notification_events: fictionalNotifications() }, rpc: numberingRpc } });
  await page.goto(`${suite.url}/operations/`);
  await waitFor(async () => await page.$eval("#hub", el => !el.hidden));
  await waitFor(async () => (await page.$$("#leadList [data-lead-id]")).length === 3);
  await waitFor(async () => await page.$eval("#totalBilled", el => el.textContent !== "—"));
  await new Promise(r => setTimeout(r, 600));
  const tag = `${role}-${w}`;
  await page.screenshot({ path: `${out}/live-mock-${tag}-fold.png` });
  for (const [sel, name] of [["#financeOverview", "finance"], ["#customers", "customers"], ["#business", "business"]]) {
    if (mobile) await page.evaluate(v => document.querySelector(`.mobile-nav button[data-mobile-view="${v}"]`)?.click(), name === "customers" ? "work" : "money");
    const el = await page.$(sel); if (!el) continue;
    const visible = await page.evaluate(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.hidden; }, el);
    if (!visible) { console.log("not visible (expected for staff):", tag, name); continue; }
    await el.scrollIntoView(); await new Promise(r => setTimeout(r, 300)); await el.screenshot({ path: `${out}/live-mock-${tag}-${name}.png` }); console.log("shot", tag, name);
  }
  await page.close();
}
await suite.close();
