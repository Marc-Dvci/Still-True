// Shared rendering for the departure board: rows, flaps, highlighted findings, fixes.
export type Verdict = "still_true" | "review" | "hold";

export interface Evidence {
  label: string;
  value: string;
  source?: string | null;
  readAt?: string | null;
}

export interface Finding {
  detector: string;
  code: string;
  verdict: "review" | "hold";
  title: string;
  detail: string;
  evidence: Evidence[];
  spans: [number, number][];
  fix?: { kind: "replace_text" | "reschedule"; summary: string; text?: string; dueAt?: string };
}

export interface RowModel {
  id: string;
  text: string;
  dueAt: string | null;
  timezone: string;
  channel: { name: string; service: string } | null;
  verdict: Verdict | "unchecked";
  status?: "scheduled" | "held" | "draft";
  findings: Finding[];
  checkedAt?: string | null;
}

export interface RowActions {
  onFix?: (row: RowModel, finding: Finding) => Promise<void>;
  onSuggest?: (row: RowModel, finding: Finding, slot: HTMLElement) => Promise<void>;
  onDismiss?: (row: RowModel, finding: Finding) => Promise<void>;
  onRelease?: (row: RowModel) => Promise<void>;
}

export const LABELS: Record<string, string> = {
  still_true: "Still true",
  review: "Review",
  hold: "Held",
  unchecked: "Checking",
  draft: "Draft",
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Split-flap: the label shuffles through letters, then settles. */
export function setFlap(node: HTMLElement, label: string, className: string): void {
  node.className = `flap ${className}`;
  node.setAttribute("aria-label", label);
  if (reduced() || node.textContent === label) {
    node.textContent = label;
    return;
  }
  const target = label.toUpperCase();
  let frame = 0;
  const frames = 9;
  const tick = () => {
    frame += 1;
    if (frame >= frames) {
      node.textContent = label;
      return;
    }
    node.textContent = target
      .split("")
      .map((ch, i) =>
        ch === " " || i < (frame / frames) * target.length
          ? ch
          : GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
      )
      .join("");
    window.setTimeout(tick, 45);
  };
  tick();
}

export function flap(label: string, className: string): HTMLElement {
  const node = el("span", { class: `flap ${className}`, "aria-label": label }, label);
  return node;
}

export function localTime(iso: string | null, timeZone: string): { time: string; day: string } {
  if (!iso) return { time: "--:--", day: "" };
  const date = new Date(iso);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
  return { time, day };
}

/** Appends the post text to `target`, with the spans the findings are about marked. */
export function highlightInto(target: HTMLElement, text: string, findings: Finding[]): HTMLElement {
  const spans = findings
    .flatMap((f) => f.spans.map(([s, e]) => ({ s, e, hold: f.verdict === "hold" })))
    .filter((x) => x.e > x.s)
    .sort((a, b) => a.s - b.s);
  let cursor = 0;
  for (const span of spans) {
    if (span.s < cursor) continue;
    target.append(text.slice(cursor, span.s));
    target.append(el("mark", { class: span.hold ? "hold" : "" }, text.slice(span.s, span.e)));
    cursor = span.e;
  }
  target.append(text.slice(cursor));
  return target;
}

/** A word-level diff between the post and the fixed text. */
export function diff(before: string, after: string): HTMLElement {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA -= 1;
    endB -= 1;
  }
  const node = el("p", { class: "fix" });
  node.append(a.slice(0, start).join(""));
  const removed = a.slice(start, endA + 1).join("");
  const added = b.slice(start, endB + 1).join("");
  if (removed) node.append(el("del", {}, removed));
  if (removed && added) node.append(" ");
  if (added) node.append(el("ins", {}, added));
  node.append(a.slice(endA + 1).join(""));
  return node;
}

function evidenceList(evidence: Evidence[]): HTMLElement {
  const dl = el("dl", { class: "evidence" });
  for (const item of evidence) {
    dl.append(el("dt", {}, item.label));
    const dd = el("dd", {});
    if (item.source)
      dd.append(el("a", { href: item.source, rel: "noopener noreferrer", target: "_blank" }, item.value));
    else dd.append(item.value);
    if (item.readAt)
      dd.append(
        el(
          "span",
          { class: "muted" },
          ` · read ${new Date(item.readAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
        ),
      );
    dl.append(dd);
  }
  return dl;
}

function busy(button: HTMLButtonElement, work: () => Promise<void>): void {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await work();
    } finally {
      button.disabled = false;
    }
  });
}

export function renderRow(row: RowModel, actions: RowActions = {}, open = false): HTMLLIElement {
  const li = el("li", { class: `row${open ? " open" : ""}`, id: `post-${row.id}` });
  const { time, day } = localTime(row.dueAt, row.timezone);
  const statusKey =
    row.status === "held"
      ? "hold"
      : row.status === "draft" && row.verdict === "still_true"
        ? "draft"
        : row.verdict;
  // "Held" only for posts Still True moved to drafts; a draft with a hold-level problem reads "Fix first".
  const label =
    row.status === "held"
      ? "Held"
      : row.status === "draft" && row.verdict === "hold"
        ? "Fix first"
        : (LABELS[statusKey] ?? statusKey);
  const flapNode = flap(label, statusKey);
  const summary = el(
    "button",
    { class: "summary", type: "button", "aria-expanded": String(open), "aria-controls": `detail-${row.id}` },
    el(
      "span",
      { class: "when" },
      el("span", { class: "flap time-flap" }, time),
      el("span", { class: "day" }, day),
    ),
    el(
      "span",
      { class: "channel" },
      row.channel?.name ?? "Channel",
      el("small", {}, row.channel?.service ?? ""),
    ),
    highlightInto(el("span", { class: "text" }), row.text, row.findings),
    el(
      "span",
      { class: "status" },
      flapNode,
      row.findings.length
        ? el("small", {}, `${row.findings.length} finding${row.findings.length > 1 ? "s" : ""}`)
        : null,
    ),
  );
  summary.addEventListener("click", () => {
    const isOpen = li.classList.toggle("open");
    summary.setAttribute("aria-expanded", String(isOpen));
  });
  li.append(summary);

  const detail = el("div", { class: "detail", id: `detail-${row.id}` });
  if (row.findings.length === 0) {
    detail.append(
      el(
        "p",
        { class: "muted" },
        row.verdict === "unchecked"
          ? "Not checked yet."
          : "Nothing in this post contradicts the day it goes out.",
      ),
    );
  }
  for (const finding of row.findings) {
    const box = el("div", { class: `finding ${finding.verdict}` });
    box.append(el("h4", {}, `${finding.verdict === "hold" ? "Hold · " : "Review · "}${finding.title}`));
    box.append(el("p", {}, finding.detail));
    box.append(evidenceList(finding.evidence));
    const buttons = el("div", { class: "actions" });
    if (finding.fix?.kind === "replace_text" && finding.fix.text) {
      box.append(el("p", { class: "muted" }, `Suggested fix: ${finding.fix.summary}`));
      box.append(diff(row.text, finding.fix.text));
    } else if (finding.fix?.kind === "reschedule") {
      box.append(el("p", { class: "muted" }, `Suggested fix: ${finding.fix.summary}`));
    }
    if (finding.fix && actions.onFix) {
      const b = el(
        "button",
        { class: "btn small", type: "button" },
        finding.fix.kind === "reschedule" ? "Move it" : "Apply fix",
      );
      busy(b, () => (actions.onFix as NonNullable<RowActions["onFix"]>)(row, finding));
      buttons.append(b);
    }
    const slot = el("div", {});
    if (actions.onSuggest && !(finding.fix?.kind === "replace_text")) {
      const b = el("button", { class: "btn small ghost", type: "button" }, "Suggest wording");
      busy(b, () => (actions.onSuggest as NonNullable<RowActions["onSuggest"]>)(row, finding, slot));
      buttons.append(b);
    }
    if (actions.onDismiss) {
      const b = el("button", { class: "linkish", type: "button" }, "It's fine, dismiss");
      busy(b, () => (actions.onDismiss as NonNullable<RowActions["onDismiss"]>)(row, finding));
      buttons.append(b);
    }
    box.append(slot);
    if (buttons.childElementCount) box.append(buttons);
    detail.append(box);
  }
  if (row.status === "held" && actions.onRelease) {
    const b = el("button", { class: "btn ghost small", type: "button" }, "Release as written");
    busy(b, () => (actions.onRelease as NonNullable<RowActions["onRelease"]>)(row));
    detail.append(
      el(
        "div",
        { class: "actions" },
        b,
        el("span", { class: "muted" }, "Puts it back in the queue at its original time."),
      ),
    );
  }
  li.append(detail);
  return li;
}

export function boardHead(): HTMLElement {
  return el(
    "div",
    { class: "board-head", "aria-hidden": "true" },
    el("span", {}, "Time"),
    el("span", {}, "Channel"),
    el("span", {}, "Post"),
    el("span", { style: "text-align:right" }, "Status"),
  );
}

export function toast(message: string): void {
  document.querySelector(".toast")?.remove();
  const node = el("div", { class: "toast", role: "status" }, message);
  document.body.append(node);
  window.setTimeout(() => node.remove(), 4200);
}

/** Animates the flaps of a freshly rendered board, row after row. */
export function cascade(list: HTMLElement): void {
  const flaps = [...list.querySelectorAll<HTMLElement>(".status .flap")];
  flaps.forEach((node, i) => {
    const label = node.getAttribute("aria-label") ?? node.textContent ?? "";
    const className = [...node.classList].filter((c) => c !== "flap").join(" ");
    node.textContent = "";
    window.setTimeout(() => setFlap(node, label, className), 120 * i);
  });
}
