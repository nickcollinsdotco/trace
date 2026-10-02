/**
 * What changed, version by version — newest first.
 *
 * One list with two readers. People: what a build did, so the version in
 * the status bar means something. The gallery: which screens a version
 * touched and how, so after an update there is a short list of things to
 * look at rather than fifty scenarios to page through.
 *
 * Written by hand with each change, beside `pnpm bump`. `version.test.ts`
 * fails if the newest entry is not the version being built, so it cannot
 * quietly fall behind.
 */
export interface Change {
  version: string;
  /** ISO date. */
  date: string;
  title: string;
  /** For people: what is different, in their words, not the code's. */
  notes: string[];
  /**
   * Gallery scenarios this version added or changed, by id, with what to
   * look for. Left out when nothing on screen changed.
   */
  screens?: Record<string, string>;
}

export const CHANGELOG: Change[] = [
  {
    version: "0.17.2",
    date: "2026-10-02",
    title: "What's new, marked",
    notes: [
      "The gallery marks screens changed in the latest update as new, and the update before as recent, until you have looked at them.",
    ],
  },
  {
    version: "0.17.1",
    date: "2026-10-02",
    title: "Quick fixes",
    notes: [
      "No more black band to scroll onto under the app.",
      "Pages scroll beneath the top bar, which is translucent; pages without one have no empty band.",
      "Type works in Shell, Teletext, Index and Scope.",
      "Scanlines go up to 24px. Flicker is gone.",
      "Reset sits at the top-right corner of a boxed section.",
      "The narrator's cursor blinks in its own text's colour.",
    ],
    screens: {
      models: "Scrolls with no empty band at the top.",
      library: "The top bar stays as you scroll, translucent; SIGNAL's cursor is quiet.",
      appearance:
        "Reset at the box's corner, scanlines to 24px, no flicker, Type in the retro themes.",
      "fun-found": "The file's frame is a border — straight in every theme.",
      "fun-narrator": "The cursor blinks in the narrator's colour, not the accent.",
      "note-enhanced": "The top bar stays as you scroll, translucent.",
    },
  },
  {
    version: "0.17.0",
    date: "2026-10-01",
    title: "The mini window can't be lost",
    notes: [
      "The mini window keeps its size moving between screens of different scaling.",
      "Bring it back from the sidebar, Ctrl+K, or Settings.",
      "Its shortcut is a setting, Ctrl+Shift+Alt+M by default.",
      "Its options menu uses switches.",
    ],
    screens: {
      "mini-options": "Switches instead of ticks; the shortcut follows Settings.",
      settings: "Shortcut and Position under Mini window.",
    },
  },
  {
    version: "0.16.1",
    date: "2026-10-01",
    title: "Updates build again",
    notes: ["Fixes pnpm update-app, which stopped at a Tauri version mismatch."],
  },
  {
    version: "0.16.0",
    date: "2026-10-01",
    title: "The mini window opens by itself",
    notes: [
      "Settings chooses when the mini window opens during a meeting.",
      "Opened by itself it never takes focus; it snaps to screen edges and remembers its place.",
    ],
    screens: {
      "mini-offer": "New: the one-time offer to open by itself.",
      settings: "A Mini window section.",
    },
  },
  {
    version: "0.15.4",
    date: "2026-10-01",
    title: "The mini window's options",
    notes: [
      "Minor controls in an options menu, and an extended view naming the microphone and model.",
    ],
    screens: {
      "mini-options": "New: the options menu.",
      "mini-details": "New: the extended view.",
    },
  },
  {
    version: "0.15.0",
    date: "2026-10-01",
    title: "The mini window",
    notes: ["A small window that floats over the call, to start, watch and stop a meeting."],
    screens: {
      "mini-live": "New.",
      "mini-idle": "New.",
      "mini-saved": "New.",
    },
  },
  {
    version: "0.14.0",
    date: "2026-10-01",
    title: "A live scope",
    notes: ["A waveform, spectrum or XY view of both voices while recording."],
    screens: { "capture-scope": "New." },
  },
  {
    version: "0.13.0",
    date: "2026-10-01",
    title: "Fun mode",
    notes: ["A narrator in the status bar, a boot sequence, and a few things to find."],
    screens: {
      "fun-narrator": "New.",
      "fun-boot": "New.",
      "fun-found": "New.",
    },
  },
];

export type Freshness = "new" | "recent";

/**
 * Which scenarios to point at: those touched by the newest version that
 * touched any are new; by the one before it, recent. Anything already
 * looked at since it changed is neither — `seen` holds the version each id
 * was last opened at.
 */
export function freshness(
  changelog: Change[],
  seen: Record<string, string> = {},
): Map<string, { tier: Freshness; version: string; what: string }> {
  const withScreens = changelog.filter((c) => c.screens && Object.keys(c.screens).length > 0);
  const out = new Map<string, { tier: Freshness; version: string; what: string }>();
  withScreens.slice(0, 2).forEach((change, i) => {
    for (const [id, what] of Object.entries(change.screens ?? {})) {
      if (out.has(id)) continue;
      const last = seen[id];
      if (last && compareVersions(last, change.version) >= 0) continue;
      out.set(id, { tier: i === 0 ? "new" : "recent", version: change.version, what });
    }
  });
  return out;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
