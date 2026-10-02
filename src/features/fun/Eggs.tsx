import { useEffect, useRef, useState } from "react";
import { isTypingTarget } from "../../design/theme";
import { unseenChanges } from "../about/changesSeen";

/*
 * The big easter eggs (docs/09-EASTER-EGGS.md). Each takes the whole
 * window for a moment, so none of them is allowed while a meeting is
 * recording (docs/13 Q6) — App checks before showing one.
 */

const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** docs/09 §2, the tiny boot sequence. */
const BOOT_LINES = [
  "mounting note buffer",
  "checking audio input",
  "preparing transcript",
  "loading context",
  "indexing memory",
  "clearing noise",
];
const BOOT_STEP_MS = 140;

/**
 * The boot sequence: Fun mode's launch, and the answer to typing `trace`.
 *
 * Any key or click ends it at once — it is a flourish, never a wait.
 */
export function Boot({ onDone }: { onDone: () => void }) {
  const instant = reducedMotion();
  // After an update, the boot owns up to it — counted from what has not been
  // read on About yet, so it says so once per update, not every launch.
  const [patch] = useState(() => {
    const unseen = unseenChanges();
    const version = unseen[0]?.version;
    if (!version) return null;
    const count = unseen.reduce((n, c) => n + c.notes.length, 0);
    return `patch ${version} applied · ${count} ${count === 1 ? "change" : "changes"}`;
  });
  const [shown, setShown] = useState(instant ? BOOT_LINES.length + 1 : 0);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const id = window.setInterval(() => setShown((n) => n + 1), BOOT_STEP_MS);
    const end = window.setTimeout(
      () => done.current(),
      (BOOT_LINES.length + 1) * BOOT_STEP_MS + 900,
    );
    const skip = () => done.current();
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("pointerdown", skip, { once: true });
    return () => {
      window.clearInterval(id);
      window.clearTimeout(end);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, []);

  return (
    <div
      role="status"
      aria-label="TRACE starting"
      className="trace-boot fixed inset-0 z-[70] flex items-center justify-center bg-surface-0"
    >
      <pre className="m-0 font-mono text-sm leading-relaxed text-ink">
        <span className="text-phosphor">TRACE / INITIALIZING</span>
        {"\n\n"}
        {BOOT_LINES.slice(0, shown).map((l) => (
          <span key={l} className="block">
            <span className="text-ink-faint">&gt; </span>
            {l.padEnd(32, ".")}
            <span className="text-phosphor"> OK</span>
          </span>
        ))}
        {shown > BOOT_LINES.length && patch && (
          <span className="block pt-4 text-ink-muted">
            <span className="text-phosphor">+ </span>
            {patch}
          </span>
        )}
        {shown > BOOT_LINES.length && (
          <span className={`block text-phosphor ${patch ? "pt-2" : "pt-4"}`}>
            READY.
            <span aria-hidden className="trace-cursor" />
          </span>
        )}
      </pre>
    </div>
  );
}

/**
 * docs/09 §16. Brand mythology, found rather than shown.
 *
 * The frame is a border, not box-drawing characters. Most of the themes'
 * fonts have no `─` or `│`, so the browser borrowed them from a fallback
 * font of another width, and the right edge came out ragged — differently
 * in every theme. Only the words are text now.
 */
const README_PATH = "FOUND: /SYSTEM/README.TXT";
const README = `TRACE exists to remember what people forget.

Conversations disappear.
Decisions drift.
Context gets lost.

So we kept a trace.`;

/** The found file: seven clicks on the wordmark. */
export function FoundFile({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (typeof el.showModal === "function") el.showModal();
    else el.setAttribute("open", "");
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label="Found file"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      className="trace-dialog m-auto border-0 bg-transparent p-0"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close the found file"
        className="block cursor-default rounded-sm bg-surface-1 p-5 text-left"
      >
        <span className="block border border-phosphor font-mono text-xs leading-snug text-phosphor">
          <span className="block border-b border-phosphor px-3 py-1.5">{README_PATH}</span>
          <pre className="m-0 px-3 py-3 font-[inherit]">{README}</pre>
        </span>
      </button>
    </dialog>
  );
}

/** Glyphs for the rain: the app's own, not borrowed katakana. */
const RAIN = "01▓▒░<>/\\|=+*#TRACE";
const RAIN_MS = 4_200;

/**
 * Phosphor rain over the whole window: the Konami code's reward.
 *
 * A canvas, drawn for a few seconds and gone. Skipped entirely under
 * reduced motion, where falling text is exactly the thing asked to stop.
 */
export function Rain({ onDone }: { onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || reducedMotion()) {
      done.current();
      return;
    }
    const scale = window.devicePixelRatio || 1;
    const width = window.innerWidth * scale;
    const height = window.innerHeight * scale;
    el.width = width;
    el.height = height;
    const size = 14 * scale;
    const colour = getComputedStyle(el).color;
    const columns = Math.ceil(width / size);
    const drops = Array.from({ length: columns }, () => Math.random() * -40);
    const start = performance.now();
    let frame = 0;

    const draw = (now: number) => {
      const t = now - start;
      // A translucent wash each frame leaves the trails that make it rain.
      ctx.fillStyle = "rgb(0 0 0 / 12%)";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = colour;
      ctx.font = `${size}px monospace`;
      // Fades out over the last second rather than stopping dead.
      ctx.globalAlpha = Math.max(0, Math.min(1, (RAIN_MS - t) / 1_000));
      drops.forEach((y, i) => {
        const glyph = RAIN[Math.floor(Math.random() * RAIN.length)] ?? "0";
        ctx.fillText(glyph, i * size, y * size);
        drops[i] = y > height / size && Math.random() > 0.96 ? 0 : y + 1;
      });
      ctx.globalAlpha = 1;
      // The wash darkens the window as it rains; fade the whole canvas out at
      // the end so the app comes back gradually, not in one frame.
      el.style.opacity = String(Math.max(0, Math.min(1, (RAIN_MS - t) / 700)));
      if (t < RAIN_MS) frame = requestAnimationFrame(draw);
      else done.current();
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[70] h-full w-full text-phosphor"
    />
  );
}

const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

/**
 * Which secret, if any, a run of keystrokes has just completed. Pure, so it
 * can be tested. Keys typed into a field never count — they are words.
 */
export function secretFor(recent: string[]): "konami" | "trace" | null {
  const tail = recent.slice(-KONAMI.length).map((k) => (k.length === 1 ? k.toLowerCase() : k));
  if (tail.length === KONAMI.length && tail.every((k, i) => k === KONAMI[i])) return "konami";
  if (
    recent
      .slice(-5)
      .map((k) => k.toLowerCase())
      .join("") === "trace"
  )
    return "trace";
  return null;
}

/** Listen for the keyboard secrets anywhere outside a text field. */
export function useSecrets(onSecret: (secret: "konami" | "trace") => void): void {
  const handler = useRef(onSecret);
  handler.current = onSecret;

  useEffect(() => {
    const recent: string[] = [];
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      recent.push(e.key);
      if (recent.length > 12) recent.shift();
      const secret = secretFor(recent);
      if (secret) {
        recent.length = 0;
        handler.current(secret);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Seven clicks on the wordmark within a few seconds. */
export function useWordmarkClicks(onFound: () => void): void {
  const handler = useRef(onFound);
  handler.current = onFound;

  useEffect(() => {
    let clicks: number[] = [];
    function onClick(e: MouseEvent) {
      if (!(e.target instanceof Element) || !e.target.closest("[data-wordmark]")) return;
      const now = Date.now();
      clicks = [...clicks.filter((t) => now - t < 4_000), now];
      if (clicks.length >= 7) {
        clicks = [];
        handler.current();
      }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}
