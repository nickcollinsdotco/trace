/**
 * TRACE_
 *
 * The blinking block cursor after the wordmark is the primary brand
 * microinteraction (docs/09-EASTER-EGGS.md §13). It is the *only* piece of
 * permanently-animated chrome in the product — everything else that moves is
 * reporting real system state. Reduced-motion users get a static block.
 */
export function Wordmark() {
  return (
    <span className="font-mono text-sm font-medium uppercase tracking-system text-ink">
      TRACE
      <span aria-hidden className="trace-cursor" />
    </span>
  );
}
