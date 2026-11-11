import * as api from "./api";
import { boardHead, cascade, el, renderRow, toast, type Finding, type RowModel } from "./ui";
import { renderScenarioPicker } from "./drill-ui";

const COUNTRIES: [string, string][] = [
  ["AU", "Australia"], ["AT", "Austria"], ["BE", "Belgium"], ["BR", "Brazil"], ["CA", "Canada"], ["DK", "Denmark"],
  ["FI", "Finland"], ["FR", "France"], ["DE", "Germany"], ["IN", "India"], ["IE", "Ireland"], ["IT", "Italy"],
  ["JP", "Japan"], ["MX", "Mexico"], ["NL", "Netherlands"], ["NZ", "New Zealand"], ["NO", "Norway"], ["PL", "Poland"],
  ["PT", "Portugal"], ["ZA", "South Africa"], ["ES", "Spain"], ["SE", "Sweden"], ["CH", "Switzerland"], ["TR", "Türkiye"],
  ["GB", "United Kingdom"], ["US", "United States"],
];

let state: api.BoardState | null = null;
let pendingLocation: api.Settings["location"] | undefined;
let lastPlaces: { name: string; latitude: number; longitude: number }[] = [];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function rowsFrom(posts: api.BoardPost[]): RowModel[] {
  return posts.map((p) => ({
    id: p.id,
    text: p.text,
    dueAt: p.dueAt,
    timezone: p.channel?.timezone || state?.account?.timezone || "UTC",
    channel: p.channel ? { name: p.channel.name, service: p.channel.service } : null,
    verdict: p.verdict,
    status: p.status,
    findings: p.findings,
    checkedAt: p.checkedAt,
  }));
}

function since(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

async function act(promise: Promise<{ ok?: boolean; message?: string }>, fallback: string): Promise<void> {
  try {
    const result = await promise;
    toast(result.message ?? fallback);
    await refresh(false);
  } catch (error) {
    toast((error as Error).message);
  }
}

const actions = {
  onFix: (row: RowModel, finding: Finding) => act(api.applyFix(row.id, finding.code), "Fix applied in Buffer."),
  onDismiss: (row: RowModel, finding: Finding) => act(api.dismiss(row.id, finding.code), "Dismissed for this post."),
  onRelease: (row: RowModel) => act(api.release(row.id), "Back in the queue."),
  onSuggest: async (row: RowModel, finding: Finding, slot: HTMLElement) => {
    slot.replaceChildren(el("p", { class: "muted" }, "Writing a suggestion…"));
    try {
      const result = await api.suggest(row.id, finding.code);
      if (!result.text) {
        slot.replaceChildren(el("p", { class: "muted" }, result.reason));
        return;
      }
      const copy = el("button", { class: "btn small ghost", type: "button" }, "Copy");
      copy.addEventListener("click", () => {
        void navigator.clipboard?.writeText(result.text as string);
        toast("Copied. Paste it into the post in Buffer.");
      });
      slot.replaceChildren(el("p", { class: "suggestion" }, result.text), el("p", { class: "muted" }, result.reason), copy);
    } catch (error) {
      slot.replaceChildren(el("p", { class: "muted" }, (error as Error).message));
    }
  },
};

function render(open = new Set<string>()): void {
  if (!state) return;
  $("account-name").textContent = state.account ? `${state.account.name}'s queue` : "Your queue";
  const counts = { hold: 0, review: 0, still_true: 0 };
  for (const p of state.posts) {
    if (p.status === "held") counts.hold += 1;
    else if (p.verdict === "review") counts.review += 1;
    else if (p.verdict === "still_true") counts.still_true += 1;
  }
  $("counts").replaceChildren(
    el("span", { class: "flap hold" }, `${counts.hold} held`),
    el("span", { class: "flap review" }, `${counts.review} review`),
    el("span", { class: "flap" }, `${counts.still_true} still true`),
  );
  $("cycle").textContent = `Last check ${since(state.budget.lastCycleAt)}${state.budget.nextCycleAt ? `, next ${new Date(state.budget.nextCycleAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""} · ${state.budget.requestsToday} Buffer requests today`;

  const host = $("board");
  if (state.posts.length === 0) {
    host.replaceChildren(
      el(
        "div",
        { class: "empty" },
        el("h2", {}, "Nothing scheduled in the next seven days"),
        el("p", {}, "Still True checks scheduled posts and drafts that have a time. Schedule something in Buffer, or add the sample drafts below to see each check work."),
      ),
    );
  } else {
    const list = el("ol", { class: "board" });
    for (const row of rowsFrom(state.posts)) list.append(renderRow(row, actions, open.has(row.id)));
    host.replaceChildren(boardHead(), list);
    if (open.size === 0) cascade(list);
  }

  const channels = $("sample-channel") as HTMLSelectElement;
  const known = new Map<string, string>();
  for (const p of state.posts) if (p.channel) known.set(p.channel.id, `${p.channel.name} (${p.channel.service})`);
  for (const c of (state as api.BoardState & { channels?: { id: string; name: string; service: string }[] }).channels ?? []) {
    known.set(c.id, `${c.name} (${c.service})`);
  }
  channels.replaceChildren(...[...known].map(([id, name]) => el("option", { value: id }, name)));
  $("add-samples").toggleAttribute("disabled", known.size === 0);
  if (known.size === 0) channels.replaceChildren(el("option", { value: "" }, "Connect a channel in Buffer first"));

  const ledger = $("ledger");
  ledger.replaceChildren(
    ...state.ledger.slice(0, 12).map((e) =>
      el("li", {}, el("div", {}, el("strong", {}, `${e.event.replace(/_/g, " ")} `), el("span", { class: "muted" }, `${new Date(e.at).toLocaleString("en-GB")} · ${e.detail}`))),
    ),
  );
  if (state.ledger.length === 0) ledger.replaceChildren(el("li", {}, el("div", { class: "muted" }, "Nothing yet.")));

  const country = $("country") as HTMLSelectElement;
  if (!country.options.length) {
    const list = COUNTRIES.some(([code]) => code === state?.settings.country) ? COUNTRIES : [...COUNTRIES, [state.settings.country, state.settings.country] as [string, string]];
    country.replaceChildren(...list.map(([code, name]) => el("option", { value: code }, name)));
  }
  country.value = state.settings.country;
  $("place-current").textContent = state.settings.location
    ? `Weather is read for ${state.settings.location.name}.`
    : "No location set: the weather check is off.";
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="policy"]')) input.checked = input.value === state.settings.policy;
}

async function refresh(animate = true): Promise<void> {
  const open = new Set([...document.querySelectorAll(".row.open")].map((n) => n.id.replace(/^post-/, "")));
  try {
    state = await api.board();
    render(animate ? new Set() : open);
  } catch (error) {
    if (error instanceof api.ApiError && error.status === 401) {
      location.href = "/?error=" + encodeURIComponent("Connect your Buffer account to see your queue.");
      return;
    }
    toast((error as Error).message);
  }
}

$("check-now").addEventListener("click", async () => {
  const button = $<HTMLButtonElement>("check-now");
  button.disabled = true;
  $("clock").classList.add("fast");
  try {
    state = await api.checkNow();
    render();
    toast("Queue checked.");
  } catch (error) {
    toast((error as Error).message);
  } finally {
    button.disabled = false;
    $("clock").classList.remove("fast");
  }
});

$("open-settings").addEventListener("click", () => {
  const panel = $("settings");
  panel.hidden = !panel.hidden;
});

let searchTimer = 0;
$("place").addEventListener("input", () => {
  const value = ($("place") as HTMLInputElement).value;
  const chosen = lastPlaces.find((p) => p.name === value);
  if (chosen) {
    pendingLocation = chosen;
    return;
  }
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(async () => {
    if (value.length < 2) return;
    const { results } = await api.locations(value).catch(() => ({ results: [] }));
    lastPlaces = results;
    $("place-results").replaceChildren(...results.map((r) => el("option", { value: r.name })));
  }, 250);
});

$("save-settings").addEventListener("click", async () => {
  const policy = document.querySelector<HTMLInputElement>('input[name="policy"]:checked')?.value as "hold" | "notes" | undefined;
  const body: Partial<api.Settings> = { country: ($("country") as HTMLSelectElement).value };
  if (policy) body.policy = policy;
  if (pendingLocation !== undefined) body.location = pendingLocation;
  try {
    await api.saveSettings(body);
    toast("Saved. The queue will be checked again in a moment.");
    pendingLocation = undefined;
    await refresh(false);
  } catch (error) {
    toast((error as Error).message);
  }
});

$("add-samples").addEventListener("click", async () => {
  const channelId = ($("sample-channel") as HTMLSelectElement).value;
  if (!channelId) return;
  const button = $<HTMLButtonElement>("add-samples");
  button.disabled = true;
  try {
    const result = await api.createSamples(channelId);
    toast(result.created ? `${result.created} sample drafts added. Checking them now…` : result.messages.join(" "));
    state = await api.checkNow();
    render();
  } catch (error) {
    toast((error as Error).message);
  } finally {
    button.disabled = false;
  }
});

$("disconnect").addEventListener("click", async () => {
  if (!window.confirm("Disconnect Still True from Buffer and delete everything it stored about your account?")) return;
  await api.disconnect().catch(() => null);
  location.href = "/?error=" + encodeURIComponent("Disconnected. Your data at Still True was deleted.");
});

$("logout").addEventListener("click", async () => {
  await api.logout().catch(() => null);
  location.href = "/";
});

renderScenarioPicker($("my-scenarios"), $("my-drill"), api.runMyDrill).catch(() => undefined);
await refresh();
window.setInterval(() => void refresh(false), 60_000);
