import { describe, expect, it } from "vitest";
import { TOOL_DEFS } from "@/lib/research/tool-defs";

type Schema = Record<string, unknown>;

// Explicitly unsupported in OpenAI's strict-schema documentation, checked 2026-11-25:
// https://developers.openai.com/api/docs/guides/prompt-generation#schemas
// https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas
// This guards the documented exclusions; it is not a complete provider validator.
const UNSUPPORTED = new Set([
  "allOf",
  "not",
  "dependentRequired",
  "dependentSchemas",
  "if",
  "then",
  "else",
  "unevaluatedProperties",
  "propertyNames",
  "minProperties",
  "maxProperties",
  "unevaluatedItems",
  "contains",
  "minContains",
  "maxContains",
  "uniqueItems",
]);

function* schemaNodes(value: unknown, path: string): Generator<[string, Schema]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const schema = value as Schema;
  yield [path, schema];
  // Property/definition names are data, not schema keywords.
  for (const key of ["properties", "$defs", "definitions"]) {
    const children = schema[key];
    if (children && typeof children === "object" && !Array.isArray(children)) {
      for (const [name, child] of Object.entries(children))
        yield* schemaNodes(child, `${path}.${key}.${name}`);
    }
  }
  yield* schemaNodes(schema.items, `${path}.items`);
  for (const key of ["anyOf", "allOf", "oneOf"]) {
    const children = schema[key];
    if (Array.isArray(children)) {
      for (const [index, child] of children.entries())
        yield* schemaNodes(child, `${path}.${key}[${index}]`);
    }
  }
}

describe("complete research tool strict schemas", () => {
  it("omits documented unsupported keywords from every advertised tool schema", () => {
    const unsupported: string[] = [];
    for (const tool of TOOL_DEFS) {
      for (const [path, schema] of schemaNodes(tool.parameters, `${tool.name}.parameters`)) {
        for (const keyword of Object.keys(schema)) {
          if (UNSUPPORTED.has(keyword)) unsupported.push(`${path}.${keyword}`);
        }
      }
    }
    expect(unsupported).toEqual([]);
  });

  it("closes strict objects and marks all declared fields required, including nullable fields", () => {
    for (const tool of TOOL_DEFS) {
      expect(tool.strict, tool.name).toBe(true);
      expect(tool.parameters.type, tool.name).toBe("object");
      for (const [path, schema] of schemaNodes(tool.parameters, `${tool.name}.parameters`)) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!types.includes("object")) continue;
        expect(schema.additionalProperties, path).toBe(false);
        expect([...(schema.required as string[])].sort(), path).toEqual(
          Object.keys(schema.properties as Schema).sort(),
        );
      }
    }
  });
});
