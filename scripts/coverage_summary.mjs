// Prints coverage/coverage-summary.json as a Markdown table, one row per module of the decision core.
import { readFileSync } from "node:fs";

const summary = JSON.parse(
  readFileSync(new URL("../coverage/coverage-summary.json", import.meta.url), "utf8"),
);
const pct = (x) => `${x.pct.toFixed(1)} %`;
const rows = Object.entries(summary)
  .filter(([file]) => file !== "total")
  .map(
    ([file, s]) =>
      `| ${file.replace(/\\/g, "/").replace(/^.*\/src\//, "src/")} | ${pct(s.lines)} | ${pct(s.branches)} | ${pct(s.functions)} |`,
  );
const t = summary.total;
console.log("| Module | Lines | Branches | Functions |\n|---|---|---|---|");
console.log(rows.join("\n"));
console.log(`| **Decision core** | **${pct(t.lines)}** | **${pct(t.branches)}** | **${pct(t.functions)}** |`);
