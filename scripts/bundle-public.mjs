import fs from "node:fs";
import path from "node:path";
const dir = path.join(process.cwd(), "public");
const files = {};
for (const name of fs.readdirSync(dir).sort()) {
  const full = path.join(dir, name);
  if (fs.statSync(full).isFile()) files[name] = fs.readFileSync(full, "utf8");
}
const out = "export const publicFiles = {\n" + Object.entries(files).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n") + "\n};\n";
fs.writeFileSync(path.join(process.cwd(), "src/publicFiles.js"), out);
console.log("bundled", Object.keys(files).join(", "));
