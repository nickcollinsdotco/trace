import { useEffect, useRef } from "react";
import { hasBackend, ipc, type StreamWave } from "../../lib/ipc";
import { bands, ease, loudness, type ScopeMode } from "./spectrum";

const POINTS = 512;
/**
 * Twenty frames a second. Each is a new 43ms window with no relation to
 * the last, so drawn faster than this — it was thirty — a raw trace only
 * flickered harder. The modes that roll move one column a frame.
 */
const FRAME_MS = 50;
/** Under reduced motion it still shows the signal, just not in motion. */
const STILL_MS = 500;
const BANDS = 32;
/** The spectrograph's rows per voice: fine enough to see a voice's pitch. */
const ROWS = 40;
/** CSS pixels a rolling mode moves each frame: 60px a second. */
const COLUMN = 3;
/** Idle static is a texture, not a signal: a dozen frames a second is plenty. */
const IDLE_MS = 80;

const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * jsdom has a canvas element but no drawing, and says so on the console —
 * which every gallery test treats as a failure. Nothing is drawn there.
 */
const canDraw = (): boolean =>
  typeof navigator === "undefined" || !navigator.userAgent.includes("jsdom");

/**
 * The live scope: both streams, drawn from the capture threads' own samples.
 *
 * Calm by design (docs/13, phase 7). The raw waveform it began as was
 * honest and unwatchable: every frame a fresh, unrelated 43ms of signal,
 * at thirty frames a second, scaled by a gain that chased it. Now:
 *
 *   wave          each voice's loudness, rolling right to left — a pause is
 *                 a flat line, a sentence a ridge
 *   spectrum      where each voice's energy sits, each band rising at once
 *                 and settling slowly, as a meter's needle does
 *   spectrograph  the spectrum over time, rolling — pitch and rhythm, the
 *                 picture the old XY figure was reaching for
 *
 * Polls at drawing speed while it is on screen and stops when it is not —
 * hidden window, unmounted screen — so a meeting recorded with the scope
 * folded away costs nothing.
 *
 * You are the accent colour; them, the muted ink. The same two colours mean
 * the same two people in the transcript.
 */
export function Scope({
  mode,
  className = "",
  label,
  idle = false,
}: {
  mode: ScopeMode;
  className?: string;
  /** What the canvas shows, for a screen reader. */
  label: string;
  /**
   * Nothing to listen to yet: the graticule and a faint hiss on two flat
   * lines, drawn here without asking the backend for anything — so the
   * scope is visibly on before a meeting, and starting one is seen as the
   * signal arriving rather than a strip appearing.
   */
  idle?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const el = canvas.current;
    if (!el || !canDraw() || (!idle && !hasBackend())) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    let busy = false;
    let last = 0;
    let frame = 0;
    let stopped = false;
    // What was drawn last, so a change of mode or size starts clean rather
    // than rolling the old picture along.
    let drawn: ScopeMode | null = null;
    let levelYou = 0;
    let levelThem = 0;
    let barsYou = new Array<number>(BANDS).fill(0);
    let barsThem = new Array<number>(BANDS).fill(0);

    // Sized in device pixels, so lines stay sharp at any display scaling.
    const resize = () => {
      const scale = window.devicePixelRatio || 1;
      const { width, height } = el.getBoundingClientRect();
      el.width = Math.max(1, Math.round(width * scale));
      el.height = Math.max(1, Math.round(height * scale));
      drawn = null;
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(el);

    const colours = () => {
      const style = getComputedStyle(el);
      const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
      return {
        you: v("--color-phosphor", "#4fd98a"),
        them: v("--color-ink-muted", "#9ba3ae"),
        grid: v("--color-line", "rgb(255 255 255 / 7%)"),
        ground: v("--scope-ground", v("--color-surface-1", "#101216")),
      };
    };
    type Colours = ReturnType<typeof colours>;

    const clear = (c: Colours) => {
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.ground;
      ctx.fillRect(0, 0, el.width, el.height);
    };

    /** A centre line, and quarters across. */
    const graticule = (c: Colours, scale: number) => {
      const { width: w, height: h } = el;
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = scale;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      for (let q = 1; q < 4; q++) {
        ctx.moveTo((w * q) / 4, 0);
        ctx.lineTo((w * q) / 4, h);
      }
      ctx.stroke();
    };

    // A pixel or so of noise on each voice's line, at a fixed size.
    const drawIdle = () => {
      const { width: w, height: h } = el;
      const c = colours();
      const scale = window.devicePixelRatio || 1;
      clear(c);
      graticule(c, scale);
      ctx.lineWidth = scale;
      const hiss = (mid: number, colour: string) => {
        ctx.strokeStyle = colour;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        const step = 3 * scale;
        for (let x = 0; x <= w; x += step) {
          const y = mid + (Math.random() - 0.5) * 2.5 * scale;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      hiss(h * 0.25, c.you);
      hiss(h * 0.75, c.them);
    };

    /**
     * Move what is drawn one column left and hand back the new column's
     * left edge. The canvas is copied onto itself, which the 2D context
     * allows: the source is read before anything is written.
     */
    const roll = (c: Colours, scale: number): { x: number; col: number } => {
      const col = Math.max(1, Math.round(COLUMN * scale));
      const { width: w, height: h } = el;
      ctx.globalAlpha = 1;
      ctx.drawImage(el, -col, 0);
      ctx.fillStyle = c.ground;
      ctx.fillRect(w - col, 0, col, h);
      // The centre line, a column at a time, so it rolls with the picture.
      ctx.fillStyle = c.grid;
      ctx.fillRect(w - col, Math.round(h / 2), col, Math.max(1, Math.round(scale)));
      return { x: w - col, col };
    };

    const draw = (waves: StreamWave[]) => {
      const { width: w, height: h } = el;
      const c = colours();
      const you = waves.find((s) => s.source === "microphone")?.samples ?? [];
      const them = waves.find((s) => s.source === "system")?.samples ?? [];
      const scale = window.devicePixelRatio || 1;
      const m = modeRef.current;
      if (drawn !== m) {
        clear(c);
        // The line the picture will roll along, there from the start, so
        // the part not yet drawn reads as waiting rather than broken.
        if (m !== "spectrum") {
          ctx.fillStyle = c.grid;
          ctx.fillRect(0, Math.round(h / 2), w, Math.max(1, Math.round(scale)));
        }
        drawn = m;
      }

      if (m === "wave") {
        // Each voice a ridge about its own line, its height its loudness.
        // A one-pixel floor, so silence still reads as a line that is on.
        levelYou = ease(levelYou, loudness(you));
        levelThem = ease(levelThem, loudness(them));
        const { x, col } = roll(c, scale);
        // A sliver of ground between columns: ruled, like a level meter,
        // rather than one solid mass.
        const bar = Math.max(1, col - Math.round(scale));
        const ridge = (level: number, mid: number, colour: string) => {
          const half = Math.max(scale / 2, level * (h / 4 - 2 * scale));
          ctx.fillStyle = colour;
          ctx.fillRect(x, mid - half, bar, half * 2);
        };
        ridge(levelYou, h * 0.25, c.you);
        ridge(levelThem, h * 0.75, c.them);
      } else if (m === "spectrum") {
        // Mirrored bars: you rising from the centre, them hanging below it.
        const up = bands(you, BANDS);
        const down = bands(them, BANDS);
        barsYou = barsYou.map((b, i) => ease(b, up[i] ?? 0));
        barsThem = barsThem.map((b, i) => ease(b, down[i] ?? 0));
        clear(c);
        graticule(c, scale);
        const slot = w / BANDS;
        const bar = Math.max(scale, slot * 0.62);
        for (let b = 0; b < BANDS; b++) {
          const x = b * slot + (slot - bar) / 2;
          const rise = (barsYou[b] ?? 0) * (h / 2 - scale);
          const fall = (barsThem[b] ?? 0) * (h / 2 - 2 * scale);
          ctx.fillStyle = c.you;
          ctx.fillRect(x, h / 2 - rise, bar, rise);
          ctx.fillStyle = c.them;
          ctx.fillRect(x, h / 2 + scale, bar, fall);
        }
      } else {
        // Low pitches meet at the centre line, high ones reach the edges —
        // the spectrum's shape, laid on its side and rolled along.
        const { x, col } = roll(c, scale);
        const row = h / 2 / ROWS;
        const paint = (levels: number[], colour: string, upward: boolean) => {
          ctx.fillStyle = colour;
          levels.forEach((v, i) => {
            if (v <= 0.02) return;
            ctx.globalAlpha = v ** 1.6;
            const y = upward ? h / 2 - (i + 1) * row : h / 2 + i * row;
            ctx.fillRect(x, y, col, Math.ceil(row));
          });
          ctx.globalAlpha = 1;
        };
        paint(bands(you, ROWS), c.you, true);
        paint(bands(them, ROWS), c.them, false);
      }
    };

    const tick = (now: number) => {
      if (stopped) return;
      frame = requestAnimationFrame(tick);
      if (idle) {
        // Still under reduced motion: one frame of hiss, then nothing.
        if (document.hidden || now - last < IDLE_MS || (last > 0 && reducedMotion())) return;
        last = now;
        drawIdle();
        return;
      }
      const every = reducedMotion() ? STILL_MS : FRAME_MS;
      // One request at a time, and none while the window is hidden.
      if (busy || document.hidden || now - last < every) return;
      busy = true;
      last = now;
      void ipc
        .scopeFrame(POINTS)
        .then((waves) => {
          if (!stopped && waves) draw(waves);
        })
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    };
    frame = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [idle]);

  return <canvas ref={canvas} role="img" aria-label={label} className={`block ${className}`} />;
}
