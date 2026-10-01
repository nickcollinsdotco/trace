/**
 * Motion: how controls answer the pointer (CONTEXT.md).
 *
 * Set per family (docs/13, Q13 and Q24), and named for what it does:
 * `scramble` redraws a label like a terminal when the pointer arrives and
 * answers a press with a burst of block characters — Retro's default;
 * `ripple` lets a quiet ripple spread from the press — Modern's; `off` does
 * neither. All of them replaced the old push-in, which made
 * every control in the app shrink by three per cent when pressed.
 *
 * One listener on the document does the lot, finding pressable controls by
 * their `.trace-press` class, so no component has to know motion exists.
 * The motion in force is read from the nearest `data-motion`, which is the
 * themed root in the app and the preview pane in the gallery.
 */

export const MOTIONS = ["scramble", "ripple", "off"] as const;

export type Motion = (typeof MOTIONS)[number];

export const MOTION_NOTES: Record<Motion, string> = {
  scramble: "Labels scramble as the pointer arrives; a press throws off a burst of blocks.",
  ripple: "A quiet ripple spreads from where you press.",
  off: "Controls change colour and nothing moves.",
};

export function isMotion(value: unknown): value is Motion {
  return typeof value === "string" && (MOTIONS as readonly string[]).includes(value);
}

export function applyMotion(motion: Motion, target: HTMLElement): void {
  target.setAttribute("data-motion", motion);
}

/** Glyphs a label passes through as it resolves. Blocks and line-drawing. */
const NOISE = "▓▒░█▄▀<>/\\|_-=+*#%01";

/**
 * A label part-way through resolving: settled up to `progress`, noise after.
 *
 * Pure, so the arithmetic can be tested. Spaces stay spaces, so a label
 * keeps its word shapes while it scrambles and reads as itself sooner.
 */
export function scrambleFrame(text: string, progress: number, random: () => number): string {
  const settled = Math.floor(text.length * Math.min(1, Math.max(0, progress)));
  let out = text.slice(0, settled);
  for (let i = settled; i < text.length; i++) {
    const ch = text[i] ?? "";
    out += ch.trim() === "" ? ch : (NOISE[Math.floor(random() * NOISE.length)] ?? ch);
  }
  return out;
}

const SCRAMBLE_MS = 260;
/** Longer labels are prose, not controls; scrambling one is noise. */
const SCRAMBLE_MAX = 28;

const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function motionAt(el: Element): Motion | null {
  const value = el.closest("[data-motion]")?.getAttribute("data-motion");
  return isMotion(value) ? value : null;
}

/** The control a pointer event belongs to, if it is a live one. */
function pressable(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>(".trace-press");
  if (!el || el.matches(":disabled, [aria-disabled='true']")) return null;
  return el;
}

/**
 * Scramble a control's label, then put it back exactly.
 *
 * Text nodes React owns are written to directly, which is safe only with two
 * guards. The label's width is pinned first, so a proportional font cannot
 * shift the layout as glyphs change. And every frame checks the node still
 * holds what was last written: if React has re-rendered the label meanwhile,
 * the scramble stops and leaves React's text alone rather than restoring a
 * stale one over it.
 */
const scrambling = new WeakSet<Text>();

function scramble(el: HTMLElement): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (
      t.data.trim() &&
      !scrambling.has(t) &&
      t.parentElement?.closest("[aria-hidden='true']") === null
    ) {
      nodes.push(t);
    }
  }
  const total = nodes.reduce((sum, n) => sum + n.data.length, 0);
  if (nodes.length === 0 || total > SCRAMBLE_MAX) return;

  const width = el.style.width;
  const pinned = el.getBoundingClientRect().width;
  el.style.width = `${pinned}px`;

  const jobs = nodes.map((node) => ({ node, original: node.data, written: node.data }));
  for (const job of jobs) scrambling.add(job.node);
  const start = performance.now();
  let done = false;

  // Settled is settled, however it ends: each label back as it was, unless
  // React has written it since, and the width let go.
  const finish = () => {
    if (done) return;
    done = true;
    for (const job of jobs) {
      if (job.node.data === job.written) job.node.data = job.original;
      scrambling.delete(job.node);
    }
    el.style.width = width;
  };

  // The clock is read here rather than taken from the frame's timestamp,
  // which not every environment measures from the same origin.
  const frame = () => {
    if (done) return;
    const progress = (performance.now() - start) / SCRAMBLE_MS;
    if (progress >= 1) {
      finish();
      return;
    }
    for (const job of jobs) {
      if (job.node.data !== job.written) continue; // React wrote here; it wins.
      job.written = scrambleFrame(job.original, progress, Math.random);
      job.node.data = job.written;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // Frames stop in a hidden window; a label must never be left scrambled.
  window.setTimeout(finish, SCRAMBLE_MS + 200);
}

/** Glyph bursts for a retro press: one row, thrown up from the pointer. */
const BURSTS = ["▁▃▅▇▅▃▁", "░▒▓█▓▒░", "<<< >>>", "[ ok ]", "·:·:·"];

/**
 * A press, answered inside the control's own frame: retro throws a burst of
 * glyphs from the pointer, soft spreads a ripple. Drawn in a layer laid over
 * the control and removed when its animation ends, so the control itself is
 * never restyled or moved.
 */
function pressEffect(el: HTMLElement, motion: Motion, x: number, y: number): void {
  const host = el.closest<HTMLElement>(".trace-shell") ?? document.body;
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);

  const frame = document.createElement("span");
  frame.className = `trace-press-fx trace-press-fx-${motion}`;
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderRadius: style.borderRadius,
  });

  const mark = document.createElement("span");
  mark.className = "trace-press-fx-mark";
  mark.style.left = `${x - rect.left}px`;
  mark.style.top = `${y - rect.top}px`;
  if (motion === "scramble") {
    mark.textContent = BURSTS[Math.floor(Math.random() * BURSTS.length)] ?? "";
  } else {
    // Big enough to reach the far corner from wherever the press landed.
    const reach = Math.hypot(
      Math.max(x - rect.left, rect.right - x),
      Math.max(y - rect.top, rect.bottom - y),
    );
    mark.style.width = mark.style.height = `${reach * 2}px`;
  }

  frame.append(mark);
  host.append(frame);
  mark.addEventListener("animationend", () => frame.remove(), { once: true });
  // A fallback, should the animation never run (a hidden window, say).
  window.setTimeout(() => frame.remove(), 1200);
}

let installed = false;

/** Listen for hovers and presses across the whole document, once. */
export function installMotion(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;

  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse" || reducedMotion()) return;
    const el = pressable(e.target);
    if (!el || motionAt(el) !== "scramble") return;
    // Only on arriving, not on moving between a control's own children.
    if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
    scramble(el);
  });

  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || reducedMotion()) return;
    const el = pressable(e.target);
    if (!el) return;
    const motion = motionAt(el);
    if (motion === "scramble" || motion === "ripple") pressEffect(el, motion, e.clientX, e.clientY);
  });
}
