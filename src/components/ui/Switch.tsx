/**
 * The look of an on/off switch, for a row that carries the role itself — a
 * menu's `menuitemcheckbox`, a labelled button — so the whole row is the
 * target rather than a 28px knob.
 *
 * Shaped by the theme's pill radius: round in the modern themes, square in
 * the ones whose every corner is square.
 */
export function SwitchLook({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-pill border transition-colors duration-150 ${
        on ? "border-phosphor bg-phosphor" : "border-line-strong bg-surface-3"
      }`}
    >
      <span
        className={`absolute left-0.5 size-2.5 rounded-pill transition-transform duration-150 ${
          on ? "translate-x-3 bg-surface-0" : "translate-x-0 bg-ink-faint"
        }`}
      />
    </span>
  );
}
