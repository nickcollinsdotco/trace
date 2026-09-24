/**
 * The library's search line, as data.
 *
 * Everything the filter controls do is written into the query as a word —
 * `tag:interview`, `len:>30m`, `sort:oldest`, `has:summary` — so the line is
 * the single source of truth. Any control can be driven by typing, any typed
 * filter shows up as the control's state, and there is no second copy of
 * the filter to fall out of step with the first.
 *
 * Words that are not filters are search terms, sent to the backend's
 * full-text search. Filters are applied here, to the listing, because they
 * read frontmatter the listing already has.
 */

import type { NoteSummary } from "../../lib/ipc";

export type Sort = "newest" | "oldest" | "longest" | "shortest";

export const SORTS: Sort[] = ["newest", "oldest", "longest", "shortest"];

/** Length buckets offered in the filter menu, as they are written. */
export const LENGTHS = [
  { token: "<15m", label: "Under 15 min" },
  { token: "15m-60m", label: "15 min – 1 hour" },
  { token: ">60m", label: "Over an hour" },
] as const;

export interface Query {
  /** Words to search for. */
  terms: string[];
  tags: string[];
  /** The length filter as written, e.g. ">30m", or null. */
  length: string | null;
  sort: Sort | null;
  hasSummary: boolean;
  type: string | null;
}

const KEYS = ["tag", "len", "sort", "has", "type"] as const;
type Key = (typeof KEYS)[number];

function split(q: string): string[] {
  return q.split(/\s+/).filter(Boolean);
}

function keyOf(word: string): Key | null {
  const i = word.indexOf(":");
  if (i <= 0 || i === word.length - 1) return null;
  const key = word.slice(0, i).toLowerCase();
  return (KEYS as readonly string[]).includes(key) ? (key as Key) : null;
}

export function parseQuery(q: string): Query {
  const out: Query = {
    terms: [],
    tags: [],
    length: null,
    sort: null,
    hasSummary: false,
    type: null,
  };
  for (const word of split(q)) {
    const key = keyOf(word);
    const value = word.slice(word.indexOf(":") + 1);
    if (key === "tag") out.tags.push(value.toLowerCase());
    else if (key === "len" && lengthRange(value)) out.length = value;
    else if (key === "sort" && (SORTS as string[]).includes(value)) out.sort = value as Sort;
    else if (key === "has" && value === "summary") out.hasSummary = true;
    else if (key === "type") out.type = value.toLowerCase();
    // A word that looks like a filter but is not a valid one is searched
    // for, rather than silently dropped.
    else out.terms.push(word);
  }
  return out;
}

/**
 * Replace every word of one kind with `value`, or remove them for null.
 *
 * The new word goes at the end, where the user's eye already is.
 */
export function setToken(q: string, key: Key, value: string | null): string {
  const kept = split(q).filter((w) => keyOf(w) !== key);
  if (value !== null) kept.push(`${key}:${value}`);
  return kept.join(" ");
}

/** What the backend should search for: the terms, and the tags it understands. */
export function searchText(query: Query): string {
  return [...query.terms, ...query.tags.map((t) => `tag:${t}`)].join(" ");
}

/** How many filters (not terms) are active, for the Filters button's badge. */
export function filterCount(query: Query): number {
  return (query.length ? 1 : 0) + (query.hasSummary ? 1 : 0) + (query.type ? 1 : 0);
}

const MINUTE = 60_000;

function minutes(s: string): number | null {
  const m = s.match(/^(\d+)(m|h)$/);
  if (!m) return null;
  return Number(m[1]) * (m[2] === "h" ? 60 : 1) * MINUTE;
}

/** `<15m`, `>1h`, `15m-60m` as a range in milliseconds. */
export function lengthRange(token: string): { min: number; max: number } | null {
  if (token.startsWith("<")) {
    const max = minutes(token.slice(1));
    return max === null ? null : { min: 0, max };
  }
  if (token.startsWith(">")) {
    const min = minutes(token.slice(1));
    return min === null ? null : { min, max: Number.POSITIVE_INFINITY };
  }
  const [a, b] = token.split("-");
  const min = a ? minutes(a) : null;
  const max = b ? minutes(b) : null;
  return min === null || max === null ? null : { min, max };
}

/** The notes a query's filters keep, in its order. Terms are not applied here. */
export function applyFilters(notes: NoteSummary[], query: Query): NoteSummary[] {
  const range = query.length ? lengthRange(query.length) : null;
  const kept = notes.filter(
    (n) =>
      query.tags.every((t) => n.tags.includes(t)) &&
      (!query.hasSummary || n.gist !== null) &&
      (!query.type || n.type === query.type) &&
      // A meeting with no recorded length cannot be said to be in a range.
      (!range || (n.durationMs !== null && n.durationMs >= range.min && n.durationMs < range.max)),
  );
  return sortNotes(kept, query.sort ?? "newest");
}

/**
 * Newest is the backend's order already — date, then start time — so it is
 * kept as given; the others are derived from it and stay stable within ties.
 */
export function sortNotes(notes: NoteSummary[], sort: Sort): NoteSummary[] {
  const length = (n: NoteSummary) => n.durationMs ?? -1;
  switch (sort) {
    case "newest":
      return [...notes];
    case "oldest":
      return [...notes].reverse();
    case "longest":
      return [...notes].sort((a, b) => length(b) - length(a));
    case "shortest":
      return [...notes].sort((a, b) => length(a) - length(b));
  }
}

/** Every tag in the library with how many meetings carry it, most used first. */
export function tagCounts(notes: NoteSummary[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
