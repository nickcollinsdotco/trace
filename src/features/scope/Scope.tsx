import { useEffect, useRef } from "react";
import { hasBackend, ipc, type StreamWave } from "../../lib/ipc";
import { bands, followGain, type ScopeMode } from "./spectrum";

const POINTS = 512;
const FRAME_MS = 33;
/** Under reduced motion it still shows the signal, just not in motion. */
const STILL_MS = 500;
const BANDS = 32;
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
 * Polls at drawing speed while it is on screen and stops when it is not —
 * hidden window, unmounted screen — so a meeting recorded with the scope
 * folded away costs nothing. Each frame is painted over the last with a
 * little of the background, so traces leave a brief phosphor afterglow.
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

    let gainYou = 0.04;
    let gainThem = 0.04;
    let busy = false;
    let last = 0;
    let frame = 0;
    let stopped = false;

    // Sized in device pixels, so lines stay sharp at any display scaling.
    const resize = () => {
      const scale = window.devicePixelRatio || 1;
      const { width, height } = el.getBoundingClientRect();
      el.width = Math.max(1, Math.round(width * scale));
      el.height = Math.max(1, Math.round(height * scale));
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

    const graticule = (c: ReturnType<typeof colours>, w: number, h: number, scale: number) => {
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

    // A pixel or so of noise on each voice's line, at a fixed size: the gain
    // that follows a real signal would blow hiss up to full height.
    const drawIdle = () => {
      const w = el.width;
      const h = el.height;
      const c = colours();
      const scale = window.devicePixelRatio || 1;
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.ground;
      ctx.fillRect(0, 0, w, h);
      graticule(c, w, h, scale);
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
      hiss(h * 0.27, c.you);
      hiss(h * 0.73, c.them);
    };

    const draw = (waves: StreamWave[]) => {
      const w = el.width;
      const h = el.height;
      const c = colours();
      const you = waves.find((s) => s.source === "microphone")?.samples ?? [];
      const them = waves.find((s) => s.source === "system")?.samples ?? [];
      const scale = window.devicePixelRatio || 1;

      // The afterglow: last frame fades rather than vanishing.
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = c.ground;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;

      // A graticule, faint: a centre line, and quarters across.
      graticule(c, w, h, scale);

      ctx.lineWidth = 1.5 * scale;
      ctx.lineJoin = "round";
      gainYou = followGain(gainYou, you);
      gainThem = followGain(gainThem, them);
      const m = modeRef.current;

      if (m === "wave") {
        // You in the top half, them in the bottom, each with its own gain.
        const trace = (
          samples: number[],
          gain: number,
          mid: number,
          span: number,
          colour: string,
        ) => {
          if (samples.length < 2) return;
          ctx.strokeStyle = colour;
          ctx.beginPath();
          samples.forEach((s, i) => {
            const x = (i / (samples.length - 1)) * w;
            const y = mid - (s / gain) * span;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        };
        trace(you, gainYou, h * 0.27, h * 0.22, c.you);
        trace(them, gainThem, h * 0.73, h * 0.22, c.them);
      } else if (m === "spectrum") {
        // Mirrored bars: you rising from the centre, them hanging below it.
        const up = bands(you, BANDS);
        const down = bands(them, BANDS);
        const slot = w / BANDS;
        const bar = Math.max(scale, slot * 0.62);
        for (let b = 0; b < BANDS; b++) {
          const x = b * slot + (slot - bar) / 2;
          ctx.fillStyle = c.you;
          ctx.fillRect(
            x,
            h / 2 - (up[b] ?? 0) * (h / 2 - scale),
            bar,
            (up[b] ?? 0) * (h / 2 - scale),
          );
          ctx.fillStyle = c.them;
          ctx.fillRect(x, h / 2 + scale, bar, (down[b] ?? 0) * (h / 2 - 2 * scale));
        }
      } else {
        // You across, them up: one voice draws a line, both a figure.
        // Stretched to the space rather than kept square: in the strip a
        // square figure was a scribble in the middle of a long dark band.
        const n = Math.min(you.length, them.length);
        // Smoothed a little first: breath and room noise turn the figure into
        // a hairball, and the shape is in the voices, not the hiss.
        const sx = smooth(you);
        const sy = smooth(them);
        const rx = w * 0.46;
        const ry = h * 0.44;
        ctx.strokeStyle = c.you;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = w / 2 + ((sx[i] ?? 0) / gainYou) * rx;
          const y = h / 2 - ((sy[i] ?? 0) / gainThem) * ry;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
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

/** A four-sample moving average: enough to lose hiss, not a voice's shape. */
function smooth(samples: number[]): number[] {
  return samples.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - 3); k <= i; k++) {
      sum += samples[k] ?? 0;
      count++;
    }
    return sum / count;
  });
}
