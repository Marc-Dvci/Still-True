// Writes random local secrets for `wrangler dev --env e2e` (the no-key demo). Never used in production.
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const file = new URL("../.dev.vars.e2e", import.meta.url);
if (!existsSync(file)) {
  const key = () => randomBytes(32).toString("base64");
  writeFileSync(file, `SESSION_SECRET=${key()}\nTOKEN_KEY=${key()}\n`);
  console.log(".dev.vars.e2e written");
}
