import test from "node:test";
import assert from "node:assert/strict";
import { loadBusinessRows } from "./business-records.mjs";
function clientFor(pages) {
  let index = 0;
  return { from() { return { select() { return this; }, order() { return this; }, range() { return Promise.resolve(pages[index++]); } }; } };
}
test("financial coverage exceeds server page caps", async () => {
  const rows = Array.from({length:301},(_,i)=>({id:String(i),total_pence:100}));
  const pages = [0,100,200,300].map(n=>({data:rows.slice(n,n+100),count:301}));
  const result = await loadBusinessRows(clientFor(pages),"invoice_balances","due_date",true);
  assert.equal(result.data.length,301);
  assert.equal(result.data.reduce((n,r)=>n+r.total_pence,0),30100);
});
test("partial or changing financial coverage cannot produce totals", async () => {
  for (const pages of [
    [{data:[{id:"a"}],count:2},{data:[],count:2}],
    [{data:[{id:"a"}],count:2},{data:[{id:"b"}],count:3}],
    [{data:[{id:"a"}],count:2},{data:[{id:"a"}],count:2}],
    [{data:[],count:null}], [{error:new Error("Unavailable")}]
  ]) await assert.rejects(loadBusinessRows(clientFor(pages),"quotes","created_at"));
  await assert.rejects(loadBusinessRows(clientFor([]),"profiles","id"));
});
test("verified empty financial coverage is valid", async () => {
  assert.deepEqual(await loadBusinessRows(clientFor([{data:[],count:0}]),"invoices","created_at"),{data:[],error:null});
});
