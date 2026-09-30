import { useContext, useEffect, useRef } from "react";
import { AppearanceContext, currentScreen } from "../../design/appearance";

/**
 * Film grain: a new field of noise every frame, like a projected print.
 *
 * The first grain slid one noise image about with CSS, as grained.js and
 * vault66-crt-effect both do. It read as a picture jumping around, because
 * it was one. Grain has no motion to follow: every frame is fresh noise with
 * no relation to the last. So this draws it, on a canvas, 24 times a second
 * — film's own rate, and a fraction of the work of 60.
 *
 * Generating a whole screen of noise per frame (as Jashior/grain does) costs
 * a core's worth of random numbers while a meeting is being transcribed. One
 * tile does the same job: each frame it is rolled afresh and the GPU repeats
 * it across the screen, from a random offset so the seams never sit still.
 * Every frame is new noise, with nothing in common with the one before — a
 * tile reused from a pool would be the last frame shifted, and the eye can
 * catch that.
 *
 * How it looks — blend, strength, over or behind — is screen.css's. This
 * only draws, and only while grain is on and the window can be seen.
 */
const TILE = 256;
const FPS = 24;

export function Grain() {
  const control = useContext(AppearanceContext);
  const on = control ? currentScreen(control.appearance).grain.amount > 0 : false;
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    // No OffscreenCanvas means no way to hold the tile (jsdom, in tests).
    if (!on || !el || typeof OffscreenCanvas === "undefined") return;
    const ctx = el.getContext("2d", { alpha: false });
    if (!ctx) return;

    const grain = grainer((Date.now() ^ 0x9e3779b9) >>> 0);
    if (!grain) return;

    const draw = () => {
      grain.roll();
      const pattern = ctx.createPattern(grain.tile, "repeat");
      if (!pattern) return;
      pattern.setTransform(new DOMMatrix().translateSelf(-grain.offset(), -grain.offset()));
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, el.width, el.height);
    };

    // One grain per CSS pixel: on a high-density screen the browser scales
    // it up a little, which softens it the way film grain is soft.
    const resize = () => {
      el.width = Math.max(1, Math.ceil(el.clientWidth));
      el.height = Math.max(1, Math.ceil(el.clientHeight));
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    // Reduced motion: one still frame of grain, never a moving one.
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return () => observer.disconnect();
    }

    // requestAnimationFrame stops by itself when the window is hidden.
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last >= 1000 / FPS) {
        last = now;
        draw();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [on]);

  return <canvas ref={canvas} aria-hidden className="trace-fx trace-fx-grain" />;
}

/**
 * Grey levels by chance: mostly black, with specks of every brightness.
 *
 * Drawn for a `screen` blend, which can only lighten: over the dark ground
 * the specks show, over a bright letter they add almost nothing. The skew
 * towards black is what makes it read as grain rather than television snow.
 * A table, because a power per pixel was most of the cost of a frame.
 */
const LEVELS = (() => {
  const table = new Uint32Array(1024);
  for (let i = 0; i < table.length; i++) {
    const v = Math.round(((i + 0.5) / table.length) ** 2.6 * 255);
    // Little-endian RGBA: alpha in the top byte.
    table[i] = 0xff000000 | (v << 16) | (v << 8) | v;
  }
  return table;
})();

/**
 * One tile of grain, rolled afresh on demand.
 *
 * The pixel buffer is allocated once and the generator is inlined: at 24
 * frames a second the per-pixel cost is the whole cost, and xorshift in a
 * tight loop over a reused buffer is several times faster than calling out
 * for each random number.
 */
function grainer(seed: number) {
  const tile = new OffscreenCanvas(TILE, TILE);
  const ctx = tile.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(TILE, TILE);
  const px = new Uint32Array(image.data.buffer);
  let x = seed | 0 || 1;

  return {
    tile,
    roll() {
      for (let i = 0; i < px.length; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        px[i] = LEVELS[x >>> 22] ?? 0;
      }
      ctx.putImageData(image, 0, 0);
    },
    offset() {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) % TILE;
    },
  };
}
