import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Popover, PopoverHeading, PopoverItem } from "../../components/ui/Popover";
import { SuggestionList, useSuggestionKeys } from "../../components/ui/Suggestions";
import type { NoteSummary } from "../../lib/ipc";
import { fitTags } from "./fit";
import {
  filterCount,
  LENGTHS,
  type Query,
  reverseSort,
  type Sort,
  type SortKey,
  setToken,
  sortKey,
  tagCounts,
  withKey,
} from "./query";
import { applySuggestion, suggest, wordAt } from "./suggest";

export type View = "list" | "compact";

const SORT_LABEL: Record<Sort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  longest: "Longest",
  shortest: "Shortest",
};

/**
 * The library's command line, and the controls that write into it.
 *
 * Laid out after the appllama browse bar the user pointed at: a wide search
 * field, then one bar — tag pills with their counts on the left, sort,
 * filters and the view on the right — and a quiet count beneath. Tags that
 * do not fit fold into "+N more", which opens Filters, where every tag is.
 * Every control edits the query text rather than holding state of its own —
 * see `query.ts`.
 */
export function SearchBar({
  query,
  parsed,
  onChange,
  notes,
  shown,
  view,
  onView,
  inputRef,
  searching,
}: {
  query: string;
  parsed: Query;
  onChange: (q: string) => void;
  notes: NoteSummary[];
  /** How many meetings the current query shows. */
  shown: number;
  view: View;
  onView: (v: View) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Whether terms are being searched, as opposed to only filtered. */
  searching: boolean;
}) {
  const counts = tagCounts(notes);
  // A pill is "on" only when it is the one tag asked for; two tags typed by
  // hand is a query no single pill describes.
  const activeTag = parsed.tags.length === 1 ? (parsed.tags[0] ?? null) : null;
  const pinned = counts.findIndex((c) => c.tag === activeTag);
  const tagRow = useRef<HTMLFieldSetElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const fits = useFittingTags(tagRow, measure, pinned < 0 ? undefined : pinned);
  // Unmeasured — no layout, as under test — shows every tag.
  const shownTags = fits ? fits.map((i) => counts[i]).filter((c) => c !== undefined) : counts;
  const hidden = counts.length - shownTags.length;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sort = parsed.sort ?? "newest";
  const types = [...new Set(notes.map((n) => n.type))].filter((t) => t !== "general");
  const active = filterCount(parsed);

  /*
   * Autofill. The cursor's position decides which word is being completed,
   * so it is tracked rather than assumed to be at the end. Escape closes the
   * list first and clears the line second; typing opens it again.
   */
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(query.length);
  const [dismissed, setDismissed] = useState(false);
  const items = focused && !dismissed ? suggest(query, caret, notes) : [];
  const pick = (value: string) => {
    const next = applySuggestion(query, caret, value);
    onChange(next.query);
    setCaret(next.caret);
    // After the new value has rendered, or the browser puts the cursor back.
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(next.caret, next.caret));
  };
  const keys = useSuggestionKeys(items, (s) => pick(s.value), wordAt(query, caret).text !== "");

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 font-mono text-sm text-phosphor"
        >
          <span className="trace-glyph trace-field-prompt">&gt;</span>
          <span className="trace-field-icon text-ink-faint">
            <SearchIcon />
          </span>
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setDismissed(false);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? query.length)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (keys.onKeyDown(e)) return;
            if (e.key === "Escape" && items.length > 0) {
              e.preventDefault();
              setDismissed(true);
            } else if (e.key === "Escape" && query) {
              e.preventDefault();
              onChange("");
            }
          }}
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="trace-search-suggestions"
          aria-autocomplete="list"
          aria-activedescendant={
            keys.active >= 0 ? `trace-search-suggestions-${keys.active}` : undefined
          }
          placeholder="Search, or filter — tag:client with:sarah len:>30m"
          name="search"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search meetings and transcripts"
          // Padding inline: `.trace-field` sets its own, and utilities cannot
          // outrank an unlayered rule.
          style={{ paddingLeft: "2.6rem", paddingRight: "3rem" }}
          className="trace-field trace-field-pill font-mono text-sm"
        />
        <kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 rounded-xs border border-line px-1.5 font-mono text-2xs text-ink-faint"
        >
          /
        </kbd>
        <SuggestionList
          id="trace-search-suggestions"
          label="Suggestions"
          items={items}
          active={keys.active}
          onHover={keys.setActive}
          onPick={(s) => pick(s.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <fieldset
            ref={tagRow}
            className="relative m-0 flex min-w-0 flex-[1_1_12rem] items-center gap-1.5 border-0 p-0"
          >
            <legend className="sr-only">Filter by tag</legend>
            <Pill
              active={parsed.tags.length === 0}
              count={notes.length}
              onClick={() => onChange(setToken(query, "tag", null))}
            >
              All
            </Pill>
            {shownTags.map(({ tag, count }) => (
              <Pill
                key={tag}
                active={activeTag === tag}
                count={count}
                onClick={() => onChange(setToken(query, "tag", activeTag === tag ? null : tag))}
              >
                {tag}
              </Pill>
            ))}
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                title="Every tag, in Filters"
                className={MORE}
              >
                +{hidden} more
              </button>
            )}
            {/* Every pill, laid out where nothing sees it, to be measured. */}
            <div
              ref={measure}
              aria-hidden
              inert
              className="pointer-events-none invisible absolute top-0 left-0 flex w-max gap-1.5"
            >
              <span className={pillClass(false)}>
                All<span className={COUNT}>{notes.length}</span>
              </span>
              {counts.map(({ tag, count }) => (
                <span key={tag} className={pillClass(false)}>
                  {tag}
                  <span className={COUNT}>{count}</span>
                </span>
              ))}
              <span className={MORE}>+{counts.length} more</span>
            </div>
          </fieldset>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* A split button: the face turns the order round, the arrow
                chooses what is ordered. The capitals class sits on the button
                itself — browsers set buttons' text-transform to none, so it
                would not reach the label from the wrapper. */}
            <div className="trace-pill flex h-8 items-stretch rounded-pill border border-line font-mono text-xs text-ink-muted">
              <button
                type="button"
                aria-label={`${SORT_LABEL[sort]} first — reverse`}
                title={`${SORT_LABEL[reverseSort(sort)]} first`}
                onClick={() => onChange(setSort(query, reverseSort(sort)))}
                className="trace-control flex items-center gap-2 rounded-pill pr-2 pl-3 trace-press hover:text-ink"
              >
                <span aria-hidden>⇅</span>
                {SORT_LABEL[sort]}
              </button>
              <span aria-hidden className="my-1.5 w-px bg-line" />
              <Popover
                label="Sort by"
                align="end"
                trigger={
                  <span className="flex h-7.5 items-center pr-3 pl-2">
                    <span className="sr-only">Sort by</span>
                    <span aria-hidden>▾</span>
                  </span>
                }
              >
                {(close) => (
                  <>
                    <PopoverHeading>Sort by</PopoverHeading>
                    {SORT_KEYS.map(({ key, label, detail }) => (
                      <PopoverItem
                        key={key}
                        current={sortKey(sort) === key}
                        detail={detail}
                        onSelect={() => {
                          onChange(setSort(query, withKey(sort, key)));
                          close();
                        }}
                      >
                        {label}
                      </PopoverItem>
                    ))}
                  </>
                )}
              </Popover>
            </div>

            <Popover
              label="Filters"
              align="end"
              open={filtersOpen}
              onOpenChange={setFiltersOpen}
              trigger={
                <span
                  className={`trace-pill trace-control flex h-8 items-center gap-2 rounded-pill border px-3 font-mono text-xs ${
                    active > 0 ? "border-phosphor text-phosphor" : "border-line text-ink-muted"
                  }`}
                >
                  <FilterIcon />
                  Filters
                  {active > 0 && <span className="tabular-nums">{active}</span>}
                </span>
              }
            >
              {() => (
                <>
                  <PopoverHeading>Tags</PopoverHeading>
                  <div className="flex flex-wrap gap-1 px-2 pb-2">
                    {counts.map(({ tag, count }) => (
                      <Pill
                        key={tag}
                        small
                        active={activeTag === tag}
                        count={count}
                        onClick={() =>
                          onChange(setToken(query, "tag", activeTag === tag ? null : tag))
                        }
                      >
                        {tag}
                      </Pill>
                    ))}
                  </div>
                  <PopoverHeading>Length</PopoverHeading>
                  <PopoverItem
                    current={parsed.length === null}
                    onSelect={() => onChange(setToken(query, "len", null))}
                  >
                    Any length
                  </PopoverItem>
                  {LENGTHS.map((l) => (
                    <PopoverItem
                      key={l.token}
                      current={parsed.length === l.token}
                      detail={`len:${l.token}`}
                      onSelect={() =>
                        onChange(setToken(query, "len", parsed.length === l.token ? null : l.token))
                      }
                    >
                      {l.label}
                    </PopoverItem>
                  ))}
                  <PopoverHeading>Summary</PopoverHeading>
                  <PopoverItem
                    current={parsed.hasSummary}
                    detail="has:summary"
                    onSelect={() =>
                      onChange(setToken(query, "has", parsed.hasSummary ? null : "summary"))
                    }
                  >
                    Only meetings with a summary
                  </PopoverItem>
                  {/* Only once meetings have types: every one is "general" until
                      something sets it, and a filter that always shows everything
                      is noise. */}
                  {types.length > 0 && (
                    <>
                      <PopoverHeading>Type</PopoverHeading>
                      <PopoverItem
                        current={parsed.type === null}
                        onSelect={() => onChange(setToken(query, "type", null))}
                      >
                        Any type
                      </PopoverItem>
                      {types.map((t) => (
                        <PopoverItem
                          key={t}
                          current={parsed.type === t}
                          onSelect={() => onChange(setToken(query, "type", t))}
                        >
                          {t}
                        </PopoverItem>
                      ))}
                    </>
                  )}
                  {active > 0 && (
                    <div className="mt-1 border-t border-line pt-1">
                      <PopoverItem
                        onSelect={() =>
                          onChange(
                            setToken(
                              setToken(setToken(query, "len", null), "has", null),
                              "type",
                              null,
                            ),
                          )
                        }
                      >
                        Clear filters
                      </PopoverItem>
                    </div>
                  )}
                </>
              )}
            </Popover>

            <fieldset className="m-0 flex gap-0.5 rounded-pill border border-line p-px">
              <legend className="sr-only">View</legend>
              <ViewButton label="List view" active={view === "list"} onClick={() => onView("list")}>
                <ListIcon />
              </ViewButton>
              <ViewButton
                label="Compact view"
                active={view === "compact"}
                onClick={() => onView("compact")}
              >
                <CompactIcon />
              </ViewButton>
            </fieldset>
          </div>
        </div>

        <p className="font-mono text-2xs text-ink-faint">
          {searching
            ? `${shown} ${shown === 1 ? "result" : "results"}`
            : shown === notes.length
              ? `${notes.length} ${notes.length === 1 ? "meeting" : "meetings"}`
              : `${shown} of ${notes.length} meetings`}
        </p>
      </div>
    </div>
  );
}

const COUNT = "text-2xs tabular-nums opacity-60";
const MORE =
  "trace-pill trace-control flex h-8 shrink-0 items-center whitespace-nowrap rounded-pill border border-dashed border-line px-3 font-mono text-xs text-ink-muted trace-press hover:text-ink";

/** `small` in the Filters panel, where tags are a list to scan, not a bar. */
function pillClass(active: boolean, small = false): string {
  return `trace-pill trace-tag flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border font-mono text-xs trace-press ${
    small ? "h-6 px-2" : "h-8 px-3"
  } ${
    active
      ? "border-phosphor bg-phosphor-dim text-phosphor"
      : "border-transparent text-ink-muted hover:text-ink"
  }`;
}

/** The sort as a word in the line; newest is the default and goes unwritten. */
function setSort(query: string, sort: Sort): string {
  return setToken(query, "sort", sort === "newest" ? null : sort);
}

const SORT_KEYS: Array<{ key: SortKey; label: string; detail: string }> = [
  { key: "date", label: "Date", detail: "newest or oldest first" },
  { key: "length", label: "Length", detail: "longest or shortest first" },
];

/**
 * Which tags fit beside "All", from the hidden copy of every pill (fit.ts).
 * Measured again when the bar or the pills change size — a narrower window,
 * a theme whose font is wider, capitals switched on by the ladder.
 */
function useFittingTags(
  row: RefObject<HTMLElement | null>,
  measure: RefObject<HTMLElement | null>,
  pinned: number | undefined,
): number[] | null {
  const [fits, setFits] = useState<number[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setTick((t) => t + 1));
    if (row.current) observer.observe(row.current);
    if (measure.current) observer.observe(measure.current);
    return () => observer.disconnect();
  }, [row, measure]);

  // Before paint, so a bar that is too full is never seen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the re-measure signal
  useLayoutEffect(() => {
    const space = row.current?.clientWidth ?? 0;
    const items = [...(measure.current?.children ?? [])] as HTMLElement[];
    const [all, ...rest] = items.map((el) => el.offsetWidth);
    const more = rest.pop();
    // Zero is not laid out yet, not a bar with no room.
    if (!space || all === undefined || more === undefined) return setFits(null);
    const gap = Number.parseFloat(getComputedStyle(row.current as HTMLElement).columnGap) || 0;
    setFits(fitTags(rest, { space: space - all, gap, more }, pinned));
  }, [row, measure, pinned, tick]);

  return fits;
}

function Pill({
  active,
  count,
  small,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  small?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={pillClass(active, small)}
    >
      {children}
      <span className={COUNT}>{count}</span>
    </button>
  );
}

function ViewButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex size-7 items-center justify-center rounded-pill trace-press ${
        active ? "bg-phosphor-dim text-phosphor" : "text-ink-faint hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/* Icons: 16px, stroked in the current colour, so every theme recolours them. */

function SearchIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="inline-block"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" strokeLinecap="round" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M2.5 3.5h11M2.5 6h7M2.5 10h11M2.5 12.5h7" />
    </svg>
  );
}

function CompactIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M2.5 3.5h11M2.5 6.5h11M2.5 9.5h11M2.5 12.5h11" />
    </svg>
  );
}
