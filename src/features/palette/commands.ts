import type { Page } from "../../app/Sidebar";
import type { AppearanceControl } from "../../design/appearance";
import { PRESET_NOTES, PRESETS } from "../../design/screen";
import { FAMILIES, THEME_NOTES, THEMES } from "../../design/theme";
import type { FunControl } from "../fun/fun";

/**
 * What the palette can do, and how a query finds it.
 *
 * Pure, apart from the handlers it is given, so ranking and the hidden
 * commands can be tested without a screen. The palette is one box for
 * everything (docs/13-DESIGN-UPGRADES.md, Q31): commands first, then
 * meetings; a leading `>` asks for commands only.
 */
export interface Command {
  id: string;
  group: "Go to" | "Meeting" | "Theme" | "Screen" | "App";
  label: string;
  /** Extra words it answers to, which never show. */
  keywords?: string;
  /** Quiet text on the right: a shortcut, or what it is. */
  hint?: string;
  run: () => void;
  /**
   * The command's own effect, shown while it is highlighted and undone if
   * the palette closes without it. Only for changes that are safe to try on
   * and cheap to take back: themes, families, screens.
   */
  preview?: () => void;
}

export interface PaletteContext {
  navigate: (page: Page) => void;
  /** Library search, for the "search meetings for…" fallback. */
  searchLibrary: (query: string) => void;
  stopMeeting: () => void;
  openMini?: (() => void) | undefined;
  /** Bring a lost mini window back to its corner. */
  resetMini?: (() => void) | undefined;
  /** The working shortcut, if there is one to show. */
  miniShortcut?: string | null | undefined;
  openGallery: () => void;
  recording: boolean;
  appearance: AppearanceControl;
  fun?: FunControl | undefined;
}

const PLACES: Array<{ page: Page; label: string; keywords?: string }> = [
  { page: "library", label: "Meetings", keywords: "library home notes list" },
  { page: "models", label: "Models", keywords: "speech summary ollama download" },
  { page: "appearance", label: "Appearance", keywords: "theme look style screen effects" },
  { page: "settings", label: "Settings", keywords: "preferences audio microphone retention" },
  { page: "about", label: "About", keywords: "version diagnostics folders logs" },
];

export function buildCommands(ctx: PaletteContext): Command[] {
  const commands: Command[] = [];

  // A meeting first: starting one quickly is the palette's most valuable job.
  if (ctx.recording) {
    commands.push(
      {
        id: "meeting:show",
        group: "Meeting",
        label: "Go to the recording",
        keywords: "live capture notes",
        run: () => ctx.navigate("capture"),
      },
      {
        id: "meeting:stop",
        group: "Meeting",
        label: "Stop meeting",
        keywords: "end finish save",
        run: ctx.stopMeeting,
      },
    );
  } else {
    commands.push({
      id: "meeting:start",
      group: "Meeting",
      label: "Start a meeting",
      keywords: "new record capture begin",
      run: () => ctx.navigate("capture"),
    });
  }

  for (const p of PLACES) {
    commands.push({
      id: `go:${p.page}`,
      group: "Go to",
      label: p.label,
      ...(p.keywords ? { keywords: p.keywords } : {}),
      run: () => ctx.navigate(p.page),
    });
  }

  THEMES.forEach((theme, i) => {
    commands.push({
      id: `theme:${theme}`,
      group: "Theme",
      label: theme,
      keywords: `theme ${THEME_NOTES[theme]}`,
      hint: String((i + 1) % 10),
      run: () => ctx.appearance.setTheme(theme),
      preview: () => ctx.appearance.setTheme(theme),
    });
  });
  for (const family of FAMILIES) {
    commands.push({
      id: `family:${family}`,
      group: "Theme",
      label: `${family} family`,
      keywords: "family switch",
      run: () => ctx.appearance.setFamily(family),
      preview: () => ctx.appearance.setFamily(family),
    });
  }
  commands.push({
    id: "theme:reset",
    group: "Theme",
    label: "Reset this theme's adjustments",
    keywords: "undo default fine-tuning",
    run: ctx.appearance.reset,
  });

  for (const preset of PRESETS) {
    commands.push({
      id: `screen:${preset}`,
      group: "Screen",
      label: `${preset} screen`,
      keywords: `screen effects filter ${PRESET_NOTES[preset]}`,
      run: () => ctx.appearance.setPreset(preset),
      preview: () => ctx.appearance.setPreset(preset),
    });
  }

  if (ctx.fun) {
    const fun = ctx.fun;
    commands.push({
      id: "app:fun",
      group: "App",
      label: fun.on ? "Turn fun mode off" : "Turn fun mode on",
      keywords: "fun narrator easter eggs play boot",
      run: () => fun.setOn(!fun.on),
    });
  }

  if (ctx.openMini) {
    commands.push({
      id: "app:mini",
      group: "Meeting",
      label: "Open the mini window",
      keywords: "mini floating small always on top compact recorder",
      ...(ctx.miniShortcut ? { hint: ctx.miniShortcut.replace(/\bSuper\b/, "Win") } : {}),
      run: ctx.openMini,
    });
  }
  if (ctx.resetMini) {
    commands.push({
      id: "app:mini-reset",
      group: "App",
      label: "Bring the mini window back",
      keywords: "mini reset position lost missing corner find off screen",
      run: ctx.resetMini,
    });
  }

  commands.push({
    id: "app:gallery",
    group: "App",
    label: "Open the screen gallery",
    keywords: "gallery fixtures states preview build",
    hint: "Ctrl+Shift+G",
    run: ctx.openGallery,
  });

  return commands;
}

/**
 * How well some text answers a query: higher is better, null is no match.
 *
 * In order: the text starts with it, a word in it does, it appears
 * somewhere, or its letters appear in order (`apr` finds Appearance). Tight
 * enough that a short query does not match everything, loose enough to
 * forgive a skipped letter.
 */
export function score(text: string, query: string): number | null {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  if (t.startsWith(q)) return 100;
  if (t.split(/[\s:·/'’-]+/).some((w) => w.startsWith(q))) return 80;
  if (t.includes(q)) return 60;

  let at = 0;
  let gaps = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, at);
    if (found === -1) return null;
    gaps += found - at;
    at = found + 1;
  }
  // Letters scattered across a long text are a coincidence, not a match.
  return gaps > q.length * 3 ? null : Math.max(1, 40 - gaps);
}

/** The commands a query finds, best first; all of them, in order, for none. */
export function rankCommands(commands: Command[], query: string): Command[] {
  const q = query.trim();
  if (!q) return commands;
  return commands
    .map((c, i) => {
      // The label counts for more than the words behind it.
      const label = score(c.label, q);
      const rest = score(`${c.group} ${c.keywords ?? ""}`, q);
      const best = Math.max(label ?? -1, rest === null ? -1 : rest - 15);
      return { c, i, best };
    })
    .filter((r) => r.best >= 0)
    .sort((a, b) => b.best - a.best || a.i - b.i)
    .map((r) => r.c);
}

/**
 * The palette's secret answers (docs/09-EASTER-EGGS.md §18).
 *
 * Exact input only, and never offered: typing one is the discovery, and a
 * suggestion would spoil it.
 */
const HIDDEN: Record<string, string[]> = {
  "trace --why": ["because someone will ask", '"what did we decide last time?"'],
  "trace --who": ["you."],
  "trace --status": ["still listening."],
  "trace --noise": ["acceptable."],
  "trace --signal": ["found."],
  "trace --memory": ["everything worth keeping", "has a timestamp."],
  "trace --coffee": ["brewing.................. ok", "the meeting can wait four minutes."],
  "trace --cloud": ["no.", "everything stays on this machine."],
  "sudo trace": ["nice try.", "TRACE has no root. only roots."],
};

export function hiddenReply(query: string): string[] | null {
  const q = query.trim().replace(/^>\s*/, "").replace(/\s+/g, " ").toLowerCase();
  return HIDDEN[q] ?? null;
}
