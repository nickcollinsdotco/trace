import type { ReactNode, Ref } from "react";

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
 */
export function Page({
  ref,
  mode = "reading",
  kind = "page",
  bar,
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
  /** Usually a TopBar. */
  bar?: ReactNode;
  /** Classes for the column, typically its gap. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-mode={mode} data-page={kind} className="trace-page">
      <div ref={ref} className="trace-scroll">
        {bar ?? <div aria-hidden className="h-12 shrink-0" />}
        <div className={`trace-column flex flex-col ${className}`}>{children}</div>
      </div>
    </div>
  );
}
