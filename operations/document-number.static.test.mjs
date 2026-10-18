import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("app.js no longer generates quote/job/invoice numbers inline", async () => {
  const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /import \{ insertWithNumber \} from "\.\/document-number\.mjs"/);
  assert.doesNotMatch(app, /FF[QJI]-\$\{/);
  assert.equal((app.match(/insertWithNumber\(db, "(quote|work_order|invoice)"/g) || []).length, 3);
});
