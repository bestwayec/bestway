import { readFileSync, writeFileSync } from "node:fs";

const contract = JSON.parse(readFileSync(new URL("../docs/contracts/groups.v1.openapi.json", import.meta.url), "utf8"));

function render(schema) {
  if (schema.$ref) return schema.$ref.split("/").at(-1);
  if ("const" in schema) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map(value => JSON.stringify(value)).join(" | ");
  if (schema.anyOf) return schema.anyOf.map(render).join(" | ");
  if (schema.type === "array") return `Array<${render(schema.items)}>`;
  if (schema.additionalProperties) return `Record<string, ${render(schema.additionalProperties)}>`;
  if (schema.type === "object") {
    const fields = Object.entries(schema.properties).map(([name, value]) =>
      `  ${name}${schema.required.includes(name) ? "" : "?"}: ${render(value)};`);
    return `{\n${fields.join("\n")}\n}`;
  }
  return schema.type ?? "unknown";
}

const generated = [
  "// Generated from Bestway docs/contracts/groups.v1.openapi.json.",
  ...Object.entries(contract.components.schemas).map(([name, schema]) => `export type ${name} = ${render(schema)};`),
].join("\n\n") + "\n";

const web = new URL("../frontend/src/lib/group-contract.generated.ts", import.meta.url);
const desktop = process.argv[2];
if (process.argv.includes("--check")) {
  for (const path of [web, ...(desktop && desktop !== "--check" ? [desktop] : [])]) {
    if (readFileSync(path, "utf8") !== generated) throw new Error(`Generated contract differs: ${path}`);
  }
} else {
  writeFileSync(web, generated);
  if (desktop) writeFileSync(desktop, generated);
}
