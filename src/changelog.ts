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
    version: "0.27.0",
    date: "2026-10-07",
    title: "The machine talks",
    notes: [
      "The narrator is on by default, jokes included, and can be quieted under Appearance → Play or from Ctrl+K. Between its reports: machine thoughts, a little ASCII, a word on the hour, hints at the secrets. Click it. Then click it again.",
      "It types left to right in place, like someone at a keyboard — pausing at full stops — instead of growing out from the middle. It is a size larger, arrives in the accent, and has the whole middle of the status bar, so long lines are no longer cut off.",
      "The boot sequence plays at every launch; any key or click ends it. Fun mode is hidden for now.",
      "New hidden commands in Ctrl+K, drawn in ASCII. trace --help lists them.",
      "The Signal panel flicks back through past weeks with its arrows, and its year view shows every day of the past year as a square, brighter for busier. Click a week to open it.",
      "Screen effects sit behind the words by default — grain, scanlines, dot grid, glass and the refresh bar — so nothing drifts across what you are reading. Glass and the refresh bar can go behind now too. Anything still over from before is moved behind once.",
      "With a frame of lines (rule or ascii), the page's column keeps most of the effects out from under the words; they show in full in the margins.",
      "Empty states lose the diagonal stripes: a faint grid of + marks round the edges, clear behind the words, and corner marks.",
      "The mini window opens already the right size instead of jumping to it, its options menu appears without flickering, and opening and closing the menu no longer creeps the window up the screen.",
      "Pages no longer shift sideways when they grow tall enough to scroll — switching the meetings list between compact and list, for one.",
      "Fixed: a second, offset focus box around the Ctrl+K line, and around a meeting being renamed.",
      "Fixed: the new-meeting title showed the system caret beside its block cursor.",
    ],
    screens: {
      "fun-narrator":
        "The narrator, on by default. Watch it type in place, left to right; click it several times.",
      "palette-drawing": "New: trace --banner, spaces kept.",
      palette: "No second focus box round the command line.",
      "signal-year": "New: the past year as a grid. Click a column.",
      "signal-week-back": "New: two weeks back — the arrows, and the week's own numbers.",
      library:
        "The Signal panel's week arrows and week/year switch. Compact and list keep the column still.",
      "library-empty": "No more stripes: + marks at the edges, corner marks.",
      "mini-options": "The menu, in the real window, opening without a flicker or a jump.",
      appearance: "Play: the narrator's switch. Effects start behind; try crt with the rule frame.",
      "fun-boot": "Renamed Booting: it plays at every launch now.",
      "capture-setup": "One cursor in the empty title, not two.",
    },
  },
  {
    version: "0.26.0",
    date: "2026-10-06",
    title: "Ready for someone new",
    notes: [
      "No Ollama yet? The library says what it is and links to it, calmly, with a Transcripts only button for anyone who does not want summaries. First run reports it too.",
      "Ollama with no model downloads one from the notice — no terminal command to copy.",
      "Models, Appearance, Settings and About have titles that say what each page is for.",
      "An empty library shows how TRACE works in three steps, with Start a meeting in the middle.",
      "A note's ⋯ menu: copy as Markdown, show in folder, rename, delete. The file path at the foot opens its folder too.",
      "Your own notes keep their line breaks. An empty section says None. The provenance reads 'Notes written by qwen3:8b · 2 Sept 2026, 17:12'.",
      "A note that will not open says it may have been moved, with the way back.",
      "While recording, the transcript scrolls in its own box and follows the newest line; scroll up and a Latest button brings you back. The footer says notes save as you type.",
      "The scope theme's status bar is one line again, and index's dotted frame has its top edge.",
    ],
    screens: {
      "library-ollama-missing": "New: no Ollama — a calm setup card, Get Ollama, Transcripts only.",
      "library-no-model": "Download qwen3:8b from the notice, with its size.",
      "models-ollama-missing": "New: the Models page without Ollama.",
      "first-run-no-ollama": "New: the report's Summaries row, and the download button named.",
      "library-empty": "Three steps and Start a meeting.",
      "note-enhanced": "The ⋯ menu, and the provenance in words.",
      "note-raw": "Your notes, a line per line.",
      "note-nothing": "Only what the writer writes: no empty headings.",
      "note-missing": "Says what probably happened, with Back to meetings.",
      "capture-live": "The transcript in its own box; Notes save as you type.",
      "capture-error": "A failed chunk says recording carries on.",
      "capture-scope": "The notes line underlines instead of boxing.",
      models: "A title and a line saying what models are.",
      settings: "A title.",
      about: "Version, and how to get a newer one, for installers and source builds.",
    },
  },
  {
    version: "0.25.0",
    date: "2026-10-03",
    title: "A calmer scope, and the narrator centre stage",
    notes: [
      "Wave shows how loud each voice is, rolling slowly past — a pause is a flat line, a sentence a ridge — instead of a raw trace redrawn thirty times a second.",
      "Spectrum's bars rise at once and settle slowly, like a meter's needle.",
      "XY is gone. Spectrograph takes its place: each voice's pitch over time, rolling past.",
      "On the recording screen, the scope, notes and transcript sit in the page column, so the scope's modes are close to hand.",
      "The status bar names both models on one chip — Parakeet v3 · qwen3:14b — with one picker for both. The narrator sits in the middle.",
    ],
    screens: {
      "capture-live": "The scope in the column; wave rolls; spectrograph replaces XY.",
      "capture-scope": "Full screen: the rolling wave and the spectrograph.",
      "mini-live": "The waveform rolls, calmly.",
      "fun-narrator": "The narrator centred; one models chip on the left.",
      library: "One models chip in the status bar.",
    },
  },
  {
    version: "0.24.0",
    date: "2026-10-03",
    title: "The mini window, floating",
    notes: [
      "The mini window is see-through around its bar: the options menu floats above it on nothing, with no band of window behind.",
      "With the waveform on, the scope rests behind the name before a meeting — its grid and a faint hiss — so starting one is seen as the signal arriving.",
      "Details names the microphone and model by what tells them apart — Razer Seiren V3 Mini, Parakeet v3 — and the window widens to show them whole. Hover for the full names.",
    ],
    screens: {
      "mini-options": "The menu floats free above the bar; no window behind it.",
      "mini-idle": "The scope at rest behind the name: grid and faint hiss.",
      "mini-details": "Short names, shown whole; the window as wide as they need.",
    },
  },
  {
    version: "0.23.0",
    date: "2026-10-03",
    title: "The library on one bar",
    notes: [
      "Tags, sort, filters and the view switch share one bar; the meeting count sits quietly beneath.",
      "Sort reverses with one click — newest to oldest, longest to shortest. Its arrow chooses date or length.",
      "As many tags as fit are shown; the rest fold into +N more, which opens Filters, where every tag is. A tag you pick stays on the bar.",
    ],
    screens: {
      library: "One bar: tags left; sort, Filters and view right; the count beneath.",
      "library-many-tags": "New: tags that do not fit fold into +N more, which opens Filters.",
    },
  },
  {
    version: "0.22.2",
    date: "2026-10-03",
    title: "Fewer, better delights",
    notes: [
      "Shift to compare opens the two themes side by side over the page, each at full width.",
      "The static between Appearance previews is gone, and so is the contact sheet's print button.",
    ],
    screens: {
      appearance: "Shift opens the comparison over the page; no static between previews.",
      "contact-sheet": "No print button.",
    },
  },
  {
    version: "0.22.1",
    date: "2026-10-03",
    title: "A redraw instead of the flap",
    notes: [
      "Changing the capitals step now sweeps one line down the screen as it redraws, in place of the flickering letters.",
    ],
    screens: {
      appearance: "Letter case: a redraw line sweeps the page; the letters no longer flicker.",
    },
  },
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
