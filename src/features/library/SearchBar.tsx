import type { RefObject } from "react";
import { Popover, PopoverHeading, PopoverItem } from "../../components/ui/Popover";
import type { NoteSummary } from "../../lib/ipc";
import { filterCount, LENGTHS, type Query, SORTS, type Sort, setToken, tagCounts } from "./query";

export type View = "list" | "compact";

const SORT_LABEL: Record<Sort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  longest: "Longest",
  shortest: "Shortest",
};

/** Tags shown as pills before the rest fold into a menu. */
const PILLS = 5;

/**
 * The library's command line, and the controls that write into it.
 *
 * Laid out after the appllama browse bar the user pointed at: a wide search
 * field, a row of category pills with counts and the sort beside them, then
 * a count line with filters and the view switch. Every control edits the
 * query text rather than holding state of its own — see `query.ts`.
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
  const pills = counts.slice(0, PILLS);
  const rest = counts.slice(PILLS);
  // A pill is "on" only when it is the one tag asked for; two tags typed by
  // hand is a query no single pill describes.
  const activeTag = parsed.tags.length === 1 ? (parsed.tags[0] ?? null) : null;
  const sort = parsed.sort ?? "newest";
  const types = [...new Set(notes.map((n) => n.type))].filter((t) => t !== "general");
  const active = filterCount(parsed);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 font-mono text-sm text-phosphor"
        >
          <span className="trace-glyph">&gt;</span>
          <span className="trace-modern-only text-ink-faint">
            <SearchIcon />
          </span>
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              onChange("");
            }
          }}
          placeholder="Search, or filter — tag:client len:>30m"
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
      </div>

      <div className="flex items-center gap-3">
        <fieldset className="m-0 flex min-w-0 flex-1 flex-wrap items-center gap-1.5 border-0 p-0">
          <legend className="sr-only">Filter by tag</legend>
          <Pill
            active={parsed.tags.length === 0}
            count={notes.length}
            onClick={() => onChange(setToken(query, "tag", null))}
          >
            All
          </Pill>
          {pills.map(({ tag, count }) => (
            <Pill
              key={tag}
              active={activeTag === tag}
              count={count}
              onClick={() => onChange(setToken(query, "tag", activeTag === tag ? null : tag))}
            >
              {tag}
            </Pill>
          ))}
          {rest.length > 0 && (
            <Popover
              label="More tags"
              trigger={
                <span className="trace-pill rounded-pill border border-line px-3 py-1 font-mono text-xs text-ink-muted">
                  +{rest.length} <span aria-hidden>▾</span>
                </span>
              }
            >
              {(close) =>
                rest.map(({ tag, count }) => (
                  <PopoverItem
                    key={tag}
                    current={activeTag === tag}
                    detail={`${count} ${count === 1 ? "meeting" : "meetings"}`}
                    onSelect={() => {
                      onChange(setToken(query, "tag", tag));
                      close();
                    }}
                  >
                    {tag}
                  </PopoverItem>
                ))
              }
            </Popover>
          )}
        </fieldset>

        <Popover
          label="Sort"
          align="end"
          trigger={
            <span className="trace-pill flex items-center gap-2 rounded-pill border border-line px-3 py-1 font-mono text-xs text-ink-muted">
              <span aria-hidden>⇅</span>
              {SORT_LABEL[sort]}
            </span>
          }
        >
          {(close) =>
            SORTS.map((s) => (
              <PopoverItem
                key={s}
                current={s === sort}
                onSelect={() => {
                  onChange(setToken(query, "sort", s === "newest" ? null : s));
                  close();
                }}
              >
                {SORT_LABEL[s]}
              </PopoverItem>
            ))
          }
        </Popover>
      </div>

      <div className="h-px bg-line" />

      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate font-mono text-2xs text-ink-faint">
          {searching
            ? `${shown} ${shown === 1 ? "result" : "results"}`
            : shown === notes.length
              ? `${notes.length} ${notes.length === 1 ? "meeting" : "meetings"}`
              : `${shown} of ${notes.length} meetings`}
          {` · ${view} view`}
        </p>

        <Popover
          label="Filters"
          align="end"
          trigger={
            <span
              className={`trace-pill flex items-center gap-2 rounded-pill border px-3 py-1 font-mono text-xs ${
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
                        setToken(setToken(setToken(query, "len", null), "has", null), "type", null),
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

        <fieldset className="m-0 flex gap-0.5 rounded-pill border border-line p-0.5">
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
  );
}

function Pill({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`trace-pill flex items-baseline gap-1.5 rounded-pill border px-3 py-1 font-mono text-xs trace-press ${
        active
          ? "border-phosphor bg-phosphor-dim text-phosphor"
          : "border-transparent text-ink-muted hover:text-ink"
      }`}
    >
      {children}
      <span className="text-2xs tabular-nums opacity-60">{count}</span>
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
