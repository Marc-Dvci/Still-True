// Downloads Buffer's GraphQL schema by introspection and writes it as SDL to schema/buffer.graphql.
// Every operation in src/buffer/operations.ts is validated against this file in the test suite.
// Usage: BUFFER_API_KEY=... npm run schema:pull
import { writeFileSync } from "node:fs";
import { buildClientSchema, getIntrospectionQuery, printSchema, type IntrospectionQuery } from "graphql";

const key = process.env.BUFFER_API_KEY;
if (!key) {
  console.error("Set BUFFER_API_KEY to a Buffer personal API key.");
  process.exit(1);
}

const response = await fetch("https://api.buffer.com", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: getIntrospectionQuery() }),
});
const body = (await response.json()) as { data?: IntrospectionQuery; errors?: unknown };
if (!response.ok || !body.data) {
  console.error(`Introspection failed: HTTP ${response.status}`, body.errors);
  process.exit(1);
}
const sdl = printSchema(buildClientSchema(body.data));
writeFileSync(new URL("../schema/buffer.graphql", import.meta.url), `${sdl}\n`);
console.log(`schema/buffer.graphql: ${sdl.split("\n").length} lines`);
