import { boardHead, cascade, el, renderRow, type RowModel } from "./ui";
import { runDrill, type DrillResponse } from "./api";

const params = new URLSearchParams(location.search);
const error = params.get("error");
const notice = document.getElementById("error");
if (error && notice) {
  notice.textContent = error;
  notice.hidden = false;
}

async function heroBoard(): Promise<void> {
  const host = document.getElementById("hero-board");
  if (!host) return;
  const result: DrillResponse = await runDrill("los-angeles-2025-01-08");
  const list = el("ol", { class: "board" });
  for (const post of result.posts) {
    const row: RowModel = {
      id: post.id,
      text: post.text,
      dueAt: post.dueAt,
      timezone: result.scenario.timezone,
      channel: post.channel,
      verdict: post.result.verdict,
      findings: post.result.findings,
    };
    list.append(renderRow(row));
  }
  host.replaceChildren(boardHead(), list);
  cascade(list);
  const caption = document.getElementById("board-caption");
  if (caption) caption.textContent = `A small business's day of posts, replayed on ${result.scenario.title.toLowerCase()} day`;
  const source = document.getElementById("hero-source");
  if (source) {
    source.textContent = `${result.scenario.summary} ${result.counts.hold} held, ${result.counts.review} for review, ${result.counts.still_true} still true. Open a row to see why.`;
  }
}

heroBoard().catch(() => {
  const host = document.getElementById("hero-board");
  if (host) host.textContent = "The board could not load. Try the fire drill page.";
});
