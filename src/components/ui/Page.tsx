import { type ReactNode, type Ref, useCallback, useRef } from "react";
import { TopBar, useScrolledPast } from "./TopBar";

/**
 * A page: the top bar, then the scrolling column.
 *
 * Every screen used to build this itself, and each did it a little
 * differently — three top paddings, a bar on some pages and not others — so
 * the first line of a page sat at a different height on every screen. One
 * component means one answer, and the layout prototypes (layout.css) change
 * every page at once.
 *
 * The bar's height is reserved even on pages with nothing to put in it. That
 * is what makes every page start at the same height.
 *
 * Both live inside the scroller. The bar sticks, and content passes under
 * it, through a translucent fill (layout.css), so what it cuts off is seen
 * going. On a page without one, the reserved height scrolls away with the
 * content. It used to sit above the scroller, which on a page with no bar
 * left an empty band that sliced every line passing under it with no
 * visible reason.
 *
 * A `title` gives the page the heading every place in the app now has —
 * Meetings had one and Models, Settings and About opened straight onto a
 * section label, so nothing said where you were but the sidebar. Scrolled
 * out of view, the title moves up into the bar, as it does on a note.
 */
export function Page({
  ref,
  mode = "reading",
  kind = "page",
  bar,
  title,
  lead,
  className = "",
  children,
}: {
  /** The scroll container, for pages that watch their own scrolling. */
  ref?: Ref<HTMLDivElement>;
  mode?: "reading" | "capture";
  /**
   * `focus` is a page with one job, like starting a meeting. Whether it sits
   * centred is the alignment rule's decision, not the page's.
   */
  kind?: "page" | "focus";
  /** Usually a TopBar. Left out on a page with a title, which makes its own. */
  bar?: ReactNode;
  /** The page's name, as its heading. */
  title?: string;
  /** A line under the title saying what the page is for. */
  lead?: ReactNode;
  /** Classes for the column, typically its gap. */
  className?: string;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingGone = useScrolledPast(heading, scroller, title);

  // The page's own handle on the scroller and the caller's, both.
  const setScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scroller.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  const ownBar = title ? <TopBar current={title} showCurrent={headingGone} /> : null;

  return (
    <div data-mode={mode} data-page={kind} className="trace-page">
      <div ref={setScroller} className="trace-scroll">
        {bar ?? ownBar ?? <div aria-hidden className="h-12 shrink-0" />}
        <div className={`trace-column flex flex-col ${className}`}>
          {title && (
            <header className="flex flex-col gap-2">
              <h1 ref={heading} className="trace-title text-2xl text-ink">
                {title}
              </h1>
              {lead && <p className="max-w-(--reading-measure) text-sm text-ink-muted">{lead}</p>}
            </header>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
