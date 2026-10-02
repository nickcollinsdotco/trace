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
    version: "0.22.0",
    date: "2026-10-02",
    title: "A few things to try",
    notes: [
      "Changing the capitals step flickers the letters over, like a departures board.",
      "With Fun mode on, the narrator remarks on capitals: inside voices, or shouting enabled.",
      "A retro button seats as it is pressed, like a key bottoming out.",
      "The Appearance preview crackles with static as it changes channel.",
      "Hold Shift over a theme to see it beside the one in use.",
      "The gallery has a contact sheet: every theme side by side, ready to print.",
    ],
    screens: {
      appearance: "Static between previews; Shift to compare; letters flap as capitals change.",
      "contact-sheet": "New: every theme side by side, printable.",
      specimen: "Retro buttons seat when pressed.",
    },
  },
  {
    version: "0.21.0",
    date: "2026-10-02",
    title: "Appearance, reworked",
    notes: [
      "Themes are a list, grouped Modern and Retro, beside one large preview that follows the pointer and the arrow keys. Choosing is a click; the one in use is ticked.",
      "Each preview shows its own theme whole — its type, frame and capitals — not half of the one in use.",
      "Under Adjust, the theme's own choice comes first and by name — Theme · geist — and is not offered twice.",
      "With Fun mode on, the narrator has a line of its own for every theme.",
    ],
    screens: {
      appearance: "The list and its preview; Adjust names the theme's own choices.",
      "fun-narrator": "A line of its own for each theme, when one is chosen.",
    },
  },
  {
    version: "0.20.1",
    date: "2026-10-02",
    title: "A specimen in the gallery",
    notes: [
      "The gallery has a specimen: one of every kind of element, captioned with what styles it, for judging a theme and its adjustments.",
    ],
    screens: { specimen: "New: every element in one place, in the theme you are looking at." },
  },
  {
    version: "0.20.0",
    date: "2026-10-02",
    title: "Bigger buttons, and capitals as one setting",
    notes: [
      "Buttons are at least 32px tall, 36px in the modern themes.",
      "Letter case is a ladder: none, labels, controls, headings. Each step adds labels and tags, then buttons and navigation, then titles.",
      "Tags follow it everywhere, on meetings and in the filter row alike.",
      "Notes and transcripts are never in capitals, in any theme.",
    ],
    screens: {
      library: "Tags, filters and New meeting follow the theme's step; New meeting is taller.",
      "note-enhanced": "Tags in capitals where the theme's labels are; buttons at the new height.",
      models: "Download and Use at the new height.",
      appearance: "Letter case offers none, labels, controls and headings.",
    },
  },
  {
    version: "0.19.0",
    date: "2026-10-02",
    title: "Carbon, and clearer text",
    notes: [
      "The default theme is Carbon, and Modern: no prompts, a filled pill, the green kept. Your adjustments to it carry over.",
      "Every theme has three clear levels of text; Teletext's descriptions no longer read as loudly as what they describe.",
      "One way of showing where to type: the meeting title floats in every theme, and boxed search fields lose the extra >.",
      "Dropdowns and short fields in Settings and notes are as wide as what they hold.",
    ],
    screens: {
      library:
        "Carbon as Modern; the search field's > becomes a magnifier wherever fields are boxed.",
      "capture-setup": "The title floats in every theme: one prompt, no box.",
      settings: "Microphone, audio and the retention count sized to their content.",
      appearance: "Carbon listed under Modern.",
    },
  },
  {
    version: "0.18.0",
    date: "2026-10-02",
    title: "What's new, in the app",
    notes: [
      "About lists what each version changed, newest first.",
      "After an update, the status bar says so — click it to read what changed.",
      "Ctrl+K finds What's new, and knows trace --changelog.",
      "With Fun mode on, the boot sequence owns up to the patch it applied.",
      "In the gallery, New and Recent stay put and go quiet once read; N walks the changes, and Sweep runs a screen through every theme.",
    ],
    screens: {
      "about-whats-new": "New: the changelog, as the terminal prints it.",
      about: "What's new, under the version.",
      "fun-boot": "After an update, a patch line before READY.",
    },
  },
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

export interface Fresh {
  tier: Freshness;
  version: string;
  what: string;
  /** Opened since it changed. The badge stays; it only goes quiet. */
  read: boolean;
}

/**
 * Which scenarios to point at: those touched by the newest version that
 * touched any are new; by the one before it, recent. `seen` holds the
 * version each id was last opened at, which makes a change read — the
 * badge stays until a newer version takes its place, so the list still
 * says what changed after it has all been looked at.
 */
export function freshness(
  changelog: Change[],
  seen: Record<string, string> = {},
): Map<string, Fresh> {
  const withScreens = changelog.filter((c) => c.screens && Object.keys(c.screens).length > 0);
  const out = new Map<string, Fresh>();
  withScreens.slice(0, 2).forEach((change, i) => {
    for (const [id, what] of Object.entries(change.screens ?? {})) {
      if (out.has(id)) continue;
      const last = seen[id];
      const read = last !== undefined && compareVersions(last, change.version) >= 0;
      out.set(id, { tier: i === 0 ? "new" : "recent", version: change.version, what, read });
    }
  });
  return out;
}

/**
 * The entries newer than `since`. With nothing seen yet — a first launch,
 * or the first build that kept count — only the newest: twenty versions of
 * history are not news to someone meeting the app now.
 */
export function changesSince(changelog: Change[], since: string | null): Change[] {
  if (!since) return changelog.slice(0, 1);
  return changelog.filter((c) => compareVersions(c.version, since) > 0);
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
