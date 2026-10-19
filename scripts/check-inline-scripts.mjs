import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const htmlFiles = process.argv.slice(2);
if (!htmlFiles.length) htmlFiles.push("index.html", "operations/index.html", "quote-response.html");
const scratch = await mkdtemp(join(tmpdir(), "ff-inline-"));

for (const file of htmlFiles) {
  const html = await readFile(resolve(file), "utf8");
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  let checked = 0;

  for (const [, attributes, source] of scriptTags) {
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const typeMatch = /\btype\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(attributes);
    const type = (typeMatch?.[1] || typeMatch?.[2] || typeMatch?.[3] || "text/javascript").toLowerCase();
    if (type === "module") {
      // Module scripts cannot be parsed with new Function; node --check them as .mjs.
      const moduleFile = join(scratch, `inline-${checked}.mjs`);
      await writeFile(moduleFile, source);
      try { execFileSync(process.execPath, ["--check", moduleFile], { stdio:"pipe" }); }
      catch (error) { throw new SyntaxError(`${file}: invalid inline module script ${checked + 1}: ${String(error.stderr || error.message)}`); }
      checked++;
      continue;
    }
    if (!["text/javascript", "application/javascript"].includes(type)) continue;

    try {
      // Parse only; the script is never executed in Node.
      new Function(source);
    } catch (error) {
      throw new SyntaxError(`${file}: invalid inline JavaScript block ${checked + 1}: ${error.message}`, { cause:error });
    }
    checked++;
  }

  console.log(`${file}: parsed ${checked} inline JavaScript block(s)`);
}
await rm(scratch, { recursive:true, force:true });
