import type { Finding, Verdict } from "./ui";

export interface DrillResponse {
  scenario: { id: string; title: string; date: string; place: string; country: string; summary: string; sources: string[]; timezone: string; lang: string };
  posts: { id: string; text: string; dueAt: string; channel: { name: string; service: string }; result: { verdict: Verdict; findings: Finding[] } }[];
  counts: { hold: number; review: number; still_true: number };
}

export interface Scenario {
  id: string;
  title: string;
  date: string;
  place: string;
  country: string;
  summary: string;
  sources: string[];
}

export interface BoardPost {
  id: string;
  organizationId: string;
  channel: { id: string; name: string; service: string; avatar: string; timezone: string } | null;
  text: string;
  dueAt: string | null;
  createdAt: string;
  via: string;
  status: "scheduled" | "held" | "draft";
  verdict: Verdict | "unchecked";
  findings: Finding[];
  checkedAt: string | null;
  nextCheckAt: string | null;
  heldDueAt: string | null;
  links: string[];
}

export interface Settings {
  country: string;
  location: { name: string; latitude: number; longitude: number } | null;
  policy: "hold" | "notes";
}

export interface BoardState {
  account: { id: string; name: string; timezone: string } | null;
  organizations: { id: string; name: string; channelCount: number }[];
  settings: Settings;
  posts: BoardPost[];
  ledger: { at: string; postId: string | null; event: string; detail: string }[];
  budget: { requestsToday: number; lastCycleAt: string | null; nextCycleAt: string | null; remaining: number | null };
  scopes: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new ApiError(body.error ?? `Request failed (${response.status})`, response.status);
  return body;
}

export const runDrill = (scenario: string) => call<DrillResponse>("/api/drill", { method: "POST", body: JSON.stringify({ scenario }) });
export const runMyDrill = (scenario: string) => call<DrillResponse>("/api/me/drill", { method: "POST", body: JSON.stringify({ scenario }) });
export const scenarios = () => call<{ scenarios: Scenario[] }>("/api/drill/scenarios");
export const session = () => call<{ connected: boolean; configured: boolean }>("/api/session");
export const board = () => call<BoardState>("/api/me/board");
export const checkNow = () => call<BoardState>("/api/me/check", { method: "POST" });
export const release = (id: string) => call<{ ok: boolean; message: string }>(`/api/me/posts/${encodeURIComponent(id)}/release`, { method: "POST" });
export const applyFix = (id: string, code: string) =>
  call<{ ok: boolean; message: string }>(`/api/me/posts/${encodeURIComponent(id)}/fix`, { method: "POST", body: JSON.stringify({ code }) });
export const dismiss = (id: string, code: string) =>
  call<{ ok: boolean }>(`/api/me/posts/${encodeURIComponent(id)}/dismiss`, { method: "POST", body: JSON.stringify({ code }) });
export const suggest = (id: string, code: string) =>
  call<{ text: string | null; reason: string }>(`/api/me/posts/${encodeURIComponent(id)}/suggest`, { method: "POST", body: JSON.stringify({ code }) });
export const saveSettings = (settings: Partial<Settings>) => call<Settings>("/api/me/settings", { method: "PUT", body: JSON.stringify(settings) });
export const createSamples = (channelId: string) =>
  call<{ created: number; messages: string[] }>("/api/me/samples", { method: "POST", body: JSON.stringify({ channelId }) });
export const disconnect = () => call<{ deleted: boolean }>("/api/me/disconnect", { method: "POST" });
export const logout = () => call<{ connected: boolean }>("/auth/logout", { method: "POST" });
export const locations = (q: string) =>
  call<{ results: { name: string; latitude: number; longitude: number; country: string | null }[] }>(`/api/locations?q=${encodeURIComponent(q)}`);
