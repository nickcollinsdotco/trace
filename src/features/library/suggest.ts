/**
 * What the library's search line suggests as you type.
 *
 * The line is words (query.ts), so suggestions are too: each one replaces
 * the word at the cursor. A bare word offers the people, tags and filters it
 * could be the start of; a `key:` word offers that key's values. Pure, so it
 * can be tested without a field.
 */

import type { Suggestion } from "../../components/ui/Suggestions";
import type { NoteSummary } from "../../lib/ipc";
import { keyOf, LENGTHS, peopleCounts, personSlug, SORTS, tagCounts } from "./query";

/** The filters, as offered: what each one is for. */
const KEY_HINTS: Array<{ value: string; hint: string }> = [
  { value: "tag:", hint: "tagged" },
  { value: "with:", hint: "someone in it" },
  { value: "len:", hint: "how long" },
  { value: "has:summary", hint: "summarised" },
  { value: "sort:", hint: "order" },
  { value: "type:", hint: "kind of meeting" },
];

/** How many a list can offer before it stops helping. */
const MAX = 7;

export interface Word {
  start: number;
  end: number;
  text: string;
}

/** The word the cursor is in, or the empty word at it. */
export function wordAt(q: string, caret: number): Word {
  const at = Math.max(0, Math.min(caret, q.length));
  let start = at;
  while (start > 0 && !/\s/.test(q[start - 1] ?? "")) start--;
  let end = at;
  while (end < q.length && !/\s/.test(q[end] ?? "")) end++;
  return { start, end, text: q.slice(start, end) };
}

export function suggest(q: string, caret: number, notes: NoteSummary[]): Suggestion[] {
  const word = wordAt(q, caret);
  const typed = word.text.toLowerCase();

  // An empty line: say what can be typed. Anywhere else an empty word is
  // just a space between words, and a list there would chase every phrase.
  if (typed === "") {
    return q.trim() === ""
      ? KEY_HINTS.map((k) => ({ value: k.value, label: k.value, hint: k.hint }))
      : [];
  }

  const colon = typed.indexOf(":");
  const out: Suggestion[] =
    colon > 0
      ? valuesFor(typed.slice(0, colon), typed.slice(colon + 1), notes)
      : starts(typed, notes);

  // Offering exactly what is already typed is not a suggestion.
  return out.filter((s) => s.value.toLowerCase() !== typed).slice(0, MAX);
}

/** A bare word: who, which tag, or which filter it could be the start of. */
function starts(typed: string, notes: NoteSummary[]): Suggestion[] {
  const people = peopleCounts(notes)
    .filter(({ name }) =>
      personSlug(name)
        .split("-")
        .some((part) => part.startsWith(typed)),
    )
    .map(({ name, count }) => ({
      value: `with:${personSlug(name)}`,
      label: `with:${name}`,
      hint: meetings(count),
    }));
  const tags = tagCounts(notes)
    .filter(({ tag }) => tag.startsWith(typed))
    .map(({ tag, count }) => ({ value: `tag:${tag}`, label: `tag:${tag}`, hint: meetings(count) }));
  const keys = KEY_HINTS.filter((k) => k.value.startsWith(typed)).map((k) => ({
    value: k.value,
    label: k.value,
    hint: k.hint,
  }));
  return [...people, ...tags, ...keys];
}

/** A `key:` word: the values that key can take, narrowed by what follows it. */
function valuesFor(key: string, typed: string, notes: NoteSummary[]): Suggestion[] {
  switch (keyOf(`${key}:x`)) {
    case "tag":
      return tagCounts(notes)
        .filter(({ tag }) => tag.includes(typed))
        .map(({ tag, count }) => ({ value: `tag:${tag}`, label: tag, hint: meetings(count) }));
    case "with":
      return peopleCounts(notes)
        .filter(({ name }) => personSlug(name).includes(typed))
        .map(({ name, count }) => ({
          value: `with:${personSlug(name)}`,
          label: name,
          hint: meetings(count),
        }));
    case "len":
      return LENGTHS.filter((l) => l.token.includes(typed)).map((l) => ({
        value: `len:${l.token}`,
        label: l.token,
        hint: l.label,
      }));
    case "sort":
      return SORTS.filter((s) => s.startsWith(typed)).map((s) => ({
        value: `sort:${s}`,
        label: s,
      }));
    case "has":
      return "summary".startsWith(typed)
        ? [{ value: "has:summary", label: "summary", hint: "summarised" }]
        : [];
    case "type":
      return [...new Set(notes.map((n) => n.type))]
        .filter((t) => t !== "general" && t.startsWith(typed))
        .map((t) => ({ value: `type:${t}`, label: t }));
    default:
      return [];
  }
}

function meetings(count: number): string {
  return count === 1 ? "1 meeting" : `${count} meetings`;
}

/**
 * Put a suggestion in place of the word at the cursor.
 *
 * A filter's name (`tag:`) is left open, so its values can be offered next;
 * anything complete gets a space after it, ready for the next word.
 */
export function applySuggestion(
  q: string,
  caret: number,
  value: string,
): { query: string; caret: number } {
  const word = wordAt(q, caret);
  const before = q.slice(0, word.start);
  const after = q.slice(word.end);
  const open = value.endsWith(":");
  const inserted = open || after.startsWith(" ") ? value : `${value} `;
  return { query: before + inserted + after, caret: before.length + inserted.length };
}
