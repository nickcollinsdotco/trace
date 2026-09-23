import { type ReactNode, type RefObject, useEffect, useState } from "react";

/**
 * The slim bar at the top of a scrolling page: a way back, where you are,
 * and the page's own controls.
 *
 * The page's title sits large in the content at rest, and moves up here as a
 * breadcrumb only once it has scrolled out of view — Granola's move. A
 * permanent header holding the title cost the reader a band of the screen on
 * every note for something only needed after scrolling.
 */
export function TopBar({
  back,
  trail,
  current,
  showCurrent,
  children,
}: {
  back?: { label: string; onClick: () => void } | undefined;
  /** Places above this one, e.g. "Meetings" for a note. */
  trail?: string[];
  /** This page's name, shown once its own title has scrolled away. */
  current?: string | null | undefined;
  showCurrent: boolean;
  /** Controls, on the right. */
  children?: ReactNode;
}) {
  const crumbs = [...(trail ?? []), ...(showCurrent && current ? [current] : [])];

  return (
    <div
      className={`sticky top-0 z-10 border-b bg-surface-0 transition-colors ${
        showCurrent ? "border-line" : "border-transparent"
      }`}
    >
      <div className="trace-measure flex h-12 items-center gap-3 px-6">
        {back && (
          <button
            type="button"
            onClick={back.onClick}
            aria-label={back.label}
            title={back.label}
            className="flex size-7 shrink-0 items-center justify-center rounded-pill border border-line font-mono text-xs text-ink-muted trace-press hover:border-line-strong hover:text-ink"
          >
            ‹
          </button>
        )}
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-2 font-mono text-2xs tracking-system text-ink-faint">
            {crumbs.map((c, i) => (
              <li
                // The path to a crumb is unique where the name alone may not be.
                key={crumbs.slice(0, i + 1).join("/")}
                // The current page's crumb fades in rather than popping, so
                // the bar reads as the title arriving, not a layout jump.
                className={`flex min-w-0 items-center gap-2 ${
                  i === crumbs.length - 1 && showCurrent && current
                    ? "animate-[trace-crumb-in_200ms_var(--ease-out)] text-ink"
                    : ""
                }`}
                aria-current={i === crumbs.length - 1 ? "page" : undefined}
              >
                {i > 0 && (
                  <span aria-hidden className="text-ink-faint">
                    /
                  </span>
                )}
                <span className="truncate">{c}</span>
              </li>
            ))}
          </ol>
        </nav>
        {children}
      </div>
    </div>
  );
}

/**
 * Whether an element has scrolled up out of its scroll container.
 *
 * An IntersectionObserver, not a scroll listener: the browser answers only
 * when the answer changes, rather than the page asking sixty times a second.
 * Absent (in tests, say), the answer is simply "no".
 */
export function useScrolledPast(
  target: RefObject<HTMLElement | null>,
  root: RefObject<HTMLElement | null>,
  /** Changes when the target may have been replaced, e.g. the title text. */
  watch?: unknown,
): boolean {
  const [past, setPast] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `watch` re-observes a remounted target
  useEffect(() => {
    const el = target.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        // Only "past" when it left through the top; below the fold on a
        // short window is not scrolled past.
        const rootTop = entry.rootBounds?.top ?? 0;
        setPast(!entry.isIntersecting && entry.boundingClientRect.top < rootTop);
      },
      // The bar is 3rem tall and sits over the top of the content, so the
      // title counts as gone once it is behind the bar.
      { root: root.current, rootMargin: "-48px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target, root, watch]);

  return past;
}
