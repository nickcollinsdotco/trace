/**
 * A window with a smaller one tucked in its corner: the mini window, drawn as
 * Spotify and the browsers draw picture-in-picture, so it reads at a glance.
 */
export function MiniIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden
    >
      <rect x="1.5" y="2.5" width="11" height="9" rx="1" />
      <rect x="7" y="7" width="4" height="3" rx="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
