/**
 * Device and model names, short enough for the mini window's details row.
 *
 * Windows names a microphone by its role and then the device, with the
 * device in brackets — "Microphone (3- Razer Seiren V3 Mini)" — so the part
 * that tells one microphone from another is the part that was truncated.
 * The full name stays in the row's tooltip.
 */
const ROLE = /^(microphone|microphone array|headset|headset microphone|line in|external mic)$/i;

export function shortMic(name: string): string {
  let short = name.trim();
  const bracketed = short.match(/^([^()]*?)\s*\((.*)\)$/);
  if (bracketed?.[1] !== undefined && bracketed[2] && ROLE.test(bracketed[1].trim())) {
    short = bracketed[2];
  }
  return (
    short
      // Windows numbers a second device of the same make: "3- Razer…".
      .replace(/^\d+-\s*/, "")
      .replace(/\((R|TM)\)/gi, "")
      .replace(/\s+/g, " ")
      .trim() || name
  );
}

/**
 * "Parakeet TDT 0.6B v3 (int8)" as "Parakeet v3": every model is a
 * Parakeet export of one size, so the architecture, the size and the
 * quantisation say nothing that tells two apart. The version does.
 */
export function shortModel(name: string): string {
  const short = name
    .replace(/\([^)]*\)/g, "")
    .split(/\s+/)
    .filter((w) => w && !/^(tdt|ctc|rnnt)$/i.test(w) && !/^\d+(\.\d+)?[bm]$/i.test(w))
    .join(" ");
  return short || name;
}
