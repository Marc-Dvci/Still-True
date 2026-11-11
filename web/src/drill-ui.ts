import { scenarios, type DrillResponse } from "./api";
import { boardHead, cascade, el, renderRow, toast, type RowModel } from "./ui";

export function renderDrill(host: HTMLElement, result: DrillResponse): void {
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
    list.append(renderRow(row, {}, false, "drill-"));
  }
  host.replaceChildren(
    el("p", { class: "eyebrow" }, `${result.scenario.place} · ${result.scenario.date}`),
    el(
      "h3",
      {},
      `${result.counts.hold} held · ${result.counts.review} for review · ${result.counts.still_true} still true`,
    ),
    el("p", { class: "muted" }, `${result.scenario.summary} Sources: ${result.scenario.sources.join("; ")}.`),
    boardHead(),
    list,
  );
  cascade(list);
}

export async function renderScenarioPicker(
  listHost: HTMLElement,
  resultHost: HTMLElement,
  run: (id: string) => Promise<DrillResponse>,
  initial?: string,
  /** The fire-drill page keeps the chosen day in the address; the board keeps its own (#post-…) links. */
  options: { hash?: boolean } = {},
): Promise<void> {
  const { scenarios: all } = await scenarios();
  const buttons: HTMLButtonElement[] = [];
  const choose = async (id: string, button: HTMLButtonElement) => {
    for (const b of buttons) b.setAttribute("aria-pressed", String(b === button));
    resultHost.replaceChildren(el("p", { class: "muted" }, "Replaying…"));
    try {
      renderDrill(resultHost, await run(id));
      if (options.hash !== false) history.replaceState(null, "", `${location.pathname}#${id}`);
    } catch (error) {
      resultHost.replaceChildren();
      toast((error as Error).message);
    }
  };
  for (const s of all) {
    const button = el(
      "button",
      { type: "button", "aria-pressed": "false" },
      el(
        "span",
        { class: "scenario-date" },
        new Date(`${s.date}T12:00:00Z`).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
      ),
      el(
        "span",
        {},
        el("span", { class: "scenario-title" }, `${s.title}`),
        el("span", { class: "scenario-summary" }, s.summary),
      ),
      el("span", { class: "muted" }, s.place),
    );
    button.addEventListener("click", () => void choose(s.id, button));
    buttons.push(button);
    listHost.append(el("li", {}, button));
  }
  const wanted = initial ?? (options.hash !== false ? location.hash.slice(1) : "");
  const index = Math.max(
    0,
    all.findIndex((s) => s.id === wanted),
  );
  const first = buttons[index];
  if (first && all[index]) await choose(all[index].id, first);
}
