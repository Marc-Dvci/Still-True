import { readFileSync } from "node:fs";
import { buildSchema, parse, validate } from "graphql";
import { describe, expect, it } from "vitest";
import { ALL_OPERATIONS } from "../../src/buffer/operations";

const schema = buildSchema(readFileSync(new URL("../../schema/buffer.graphql", import.meta.url), "utf8"));

describe("Buffer GraphQL operations", () => {
  it.each(Object.entries(ALL_OPERATIONS))(
    "%s validates against Buffer's introspected schema",
    (_name, doc) => {
      const errors = validate(schema, parse(doc));
      expect(errors.map((e) => e.message)).toEqual([]);
    },
  );
});
