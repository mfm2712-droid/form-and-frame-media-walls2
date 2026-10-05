import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const htmlFiles = process.argv.slice(2);
if (!htmlFiles.length) htmlFiles.push("index.html", "operations/index.html");

for (const file of htmlFiles) {
  const html = await readFile(resolve(file), "utf8");
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  let checked = 0;

  for (const [, attributes, source] of scriptTags) {
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const typeMatch = /\btype\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(attributes);
    const type = (typeMatch?.[1] || typeMatch?.[2] || typeMatch?.[3] || "text/javascript").toLowerCase();
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
