import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Prompt, SystemLabel } from "../../components/ui/terminal";
import type { AppearanceControl } from "../../design/appearance";
import { hasBackend, ipc, type SearchHit } from "../../lib/ipc";
import { type Command, hiddenReply, rankCommands } from "./commands";

/** Meetings shown under the commands. More belongs on the library page. */
const MAX_HITS = 5;

type Item = { kind: "command"; command: Command } | { kind: "meeting"; hit: SearchHit };

/**
 * Ctrl+K: one box for going anywhere and doing anything.
 *
 * A native modal dialog, like the confirmation: the page behind is inert,
 * focus stays inside, and Escape closes it, without any of that written
 * by hand. The first result is always highlighted, so typing and pressing
 * Enter is the whole interaction.
 *
 * Themes, families and screens preview as they are highlighted, the way an
 * editor's theme picker does: arrow through them and the app changes under
 * the palette; Enter keeps the one on screen, and closing any other way puts
 * back what was there. Only the arrow keys preview. Typing does not — "s"
 * on the way to "settings" would flash the shell theme — and neither does a
 * mouse crossing the list on its way somewhere.
 */
export function Palette({
  commands,
  onOpenNote,
  onSearchLibrary,
  onClose,
  appearance,
  initialQuery = "",
}: {
  commands: Command[];
  onOpenNote: (path: string) => void;
  onSearchLibrary: (query: string) => void;
  onClose: () => void;
  /** To put the look back when a preview is not kept. */
  appearance?: AppearanceControl | undefined;
  initialQuery?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const hits = useMeetingSearch(query);

  // The look as the palette opened, a preview on screen, and whether Enter
  // kept it. Refs, because the unmount that undoes a preview reads them.
  const original = useRef(appearance?.appearance);
  const restore = useRef(appearance?.restore);
  restore.current = appearance?.restore;
  const previewing = useRef(false);
  const kept = useRef(false);
  const byArrow = useRef(false);

  // Every way of closing without Enter — Escape, a click outside, Ctrl+K
  // again — ends in this unmount, so undoing the preview here catches all.
  useEffect(
    () => () => {
      if (previewing.current && !kept.current && original.current) {
        restore.current?.(original.current);
      }
    },
    [],
  );

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    // Back to wherever the user was — usually the notes field mid-meeting.
    const before = document.activeElement;
    if (typeof el.showModal === "function") el.showModal();
    else el.setAttribute("open", "");
    input.current?.focus();
    return () => {
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

  const commandsOnly = query.trimStart().startsWith(">");
  const term = query.trimStart().replace(/^>\s*/, "");
  const reply = hiddenReply(query);

  const items = useMemo<Item[]>(() => {
    if (reply) return [];
    const found: Item[] = rankCommands(commands, term).map((command) => ({
      kind: "command",
      command,
    }));
    if (!commandsOnly) {
      for (const hit of hits.slice(0, MAX_HITS)) found.push({ kind: "meeting", hit });
      // Always a way into the library's own search, which holds filters the
      // palette does not.
      if (term.trim()) {
        found.push({
          kind: "command",
          command: {
            id: "search",
            group: "Go to",
            label: `Search meetings for “${term.trim()}”`,
            run: () => onSearchLibrary(term.trim()),
          },
        });
      }
    }
    return found;
  }, [commands, term, commandsOnly, hits, reply, onSearchLibrary]);

  // A new list starts at its top: Enter runs the best match.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the results change
  useEffect(() => setActive(0), [items.length, term]);

  useEffect(() => {
    const row = list.current?.querySelector(`[data-index="${active}"]`);
    // Absent in tests; a list that cannot scroll is still a working list.
    if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Keyed on the highlighted command's id, not the list: applying a preview
  // re-renders the app and rebuilds the list, which must not apply it again.
  const highlighted = items[active];
  const highlightedId =
    highlighted?.kind === "command" ? highlighted.command.id : (highlighted?.hit.path ?? "");
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per highlight
  useEffect(() => {
    if (!byArrow.current) {
      // Typed or pointed at, not browsed: the screen shows what it showed.
      if (previewing.current && original.current) {
        restore.current?.(original.current);
        previewing.current = false;
      }
      return;
    }
    const preview = highlighted?.kind === "command" ? highlighted.command.preview : undefined;
    if (preview) {
      preview();
      previewing.current = true;
    } else if (previewing.current && original.current) {
      // Moved off the looks: show the screen as it was, not the last tried.
      restore.current?.(original.current);
      previewing.current = false;
    }
  }, [highlightedId]);

  function run(item: Item | undefined) {
    if (!item) return;
    kept.current = true;
    onClose();
    if (item.kind === "command") item.command.run();
    else onOpenNote(item.hit.path);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    byArrow.current = e.key === "ArrowDown" || e.key === "ArrowUp";
    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp" && items.length) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (reply) onClose();
      else run(items[active]);
    }
  }

  // Headings appear where the group changes, so the list reads in sections
  // without a nested structure the arrow keys would have to walk.
  let lastGroup = "";

  return (
    <dialog
      ref={dialog}
      aria-label="Command palette"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A click on the shade, not the panel, closes it.
      onMouseDown={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      className="trace-dialog trace-palette mx-auto mt-[12vh] mb-auto w-[min(38rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-line-strong bg-surface-1 p-0 text-ink shadow-(--elevation-overlay)"
    >
      <div className="flex items-center gap-2 border-b border-line px-4">
        <span aria-hidden className="font-mono text-sm text-phosphor">
          <Prompt />
        </span>
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Go to, change, or find a meeting…"
          aria-label="Command"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="trace-palette-list"
          aria-activedescendant={items[active] ? `trace-palette-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className="h-12 min-w-0 flex-1 bg-transparent font-mono text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </div>

      {reply ? (
        <output
          aria-live="polite"
          className="block px-5 py-5 font-mono text-sm leading-relaxed text-phosphor"
        >
          {reply.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
          <span aria-hidden className="trace-cursor" />
        </output>
      ) : (
        <div
          ref={list}
          id="trace-palette-list"
          role="listbox"
          aria-label="Results"
          className="max-h-[min(24rem,55vh)] overflow-y-auto py-2"
        >
          {items.length === 0 && (
            <p className="px-5 py-3 font-mono text-xs text-ink-faint">
              <Prompt />
              nothing answers to that.
            </p>
          )}
          {items.map((item, i) => {
            const group = item.kind === "command" ? item.command.group : "Meetings";
            const heading = group !== lastGroup;
            lastGroup = group;
            return (
              <div key={item.kind === "command" ? item.command.id : item.hit.path}>
                {heading && (
                  <div className="px-5 pt-2 pb-1">
                    <SystemLabel>{group}</SystemLabel>
                  </div>
                )}
                <div
                  id={`trace-palette-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  tabIndex={-1}
                  onMouseMove={() => {
                    byArrow.current = false;
                    setActive(i);
                  }}
                  onClick={() => run(item)}
                  onKeyDown={() => {}}
                  className={`mx-2 flex cursor-pointer items-baseline gap-3 rounded-sm px-3 py-2 ${
                    i === active ? "bg-phosphor-dim text-ink" : "text-ink-muted"
                  }`}
                >
                  {item.kind === "command" ? (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm">{item.command.label}</span>
                      {item.command.hint && (
                        <kbd className="font-mono text-2xs text-ink-faint">{item.command.hint}</kbd>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm">{item.hit.title}</span>
                        {snippet(item.hit) && (
                          <span className="truncate text-2xs text-ink-faint">
                            {snippet(item.hit)}
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-2xs tabular-nums text-ink-faint">
                        {item.hit.date}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-5 py-2 font-mono text-2xs text-ink-faint">
        <span>↑↓ move</span>
        <span>↵ run</span>
        <span>esc close</span>
        <span>&gt; commands only</span>
      </div>
    </dialog>
  );
}

/**
 * The line that matched, as words rather than Markdown, or nothing when it
 * only repeats the title — a heading that says the meeting's name again
 * tells the reader nothing the row above it did not.
 */
function snippet(hit: SearchHit): string {
  const text = hit.snippet
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|>\s+)/, "")
    .replace(/[*_`]/g, "")
    .trim();
  return text.toLowerCase() === hit.title.toLowerCase() ? "" : text;
}

/**
 * Meetings matching the query, from the same search the library uses.
 *
 * Debounced, because each keystroke would otherwise read the notes folder.
 * Two letters at least: one matches everything and tells nobody anything.
 */
function useMeetingSearch(query: string): SearchHit[] {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const term = query.trim();

  useEffect(() => {
    if (!hasBackend() || term.startsWith(">") || term.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      void ipc
        .searchNotes(term)
        .then((found) => {
          if (!cancelled) setHits(found);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [term]);

  return hits;
}
