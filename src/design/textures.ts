/**
 * The screen effects' textures, drawn once at start-up.
 *
 * Generated rather than shipped as images: nothing is fetched, and the
 * texture is exactly the one designed here. Seeded, so every launch — and
 * every screenshot of one — draws the same lines.
 *
 * Put on the root as `--fx-lines-tex` (screen.css). Grain is not a texture:
 * it is drawn afresh every frame (Grain.tsx). A data URL, not a blob: the
 * content security policy allows `data:` images and nothing else from script.
 */

export function installTextures(root: HTMLElement = document.documentElement): void {
  const lines = drawLines();
  if (lines) root.style.setProperty("--fx-lines-tex", `url("${lines}")`);
}

/** A small, fast, seeded generator — Math.random would change every launch. */
function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(width: number, height: number): CanvasRenderingContext2D | null {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c.getContext("2d");
}

/**
 * Raster lines, after lofi.cafe's: soft bands of uneven brightness with a
 * little texture along each, for an `overlay` blend.
 *
 * Overlay is the point. It darkens what sits under a dark band and lifts what
 * sits under a light one, relative to what is there — so a letter is shaded
 * by the line, never cut by it. The first version drew these in flat black
 * and made the text unreadable.
 *
 * Drawn at twice the size it is shown, so the browser's downscale softens
 * every edge.
 */
function drawLines(): string | null {
  const width = 128;
  const period = 6;
  const bands = 6;
  const height = period * bands;
  const ctx = canvas(width, height);
  if (!ctx) return null;
  const random = seeded(0x11e5);
  // One band, top to bottom: a dark gap, a bright core, a dark gap. Shaped
  // like lofi.cafe's texture, measured from its file.
  const profile = [0.04, 0.28, 0.62, 0.66, 0.36, 0.06];
  const image = ctx.createImageData(width, height);
  const gain = Array.from({ length: bands }, () => 0.8 + random() * 0.4);
  const phase = Array.from({ length: bands }, () => random() * Math.PI * 2);
  for (let y = 0; y < height; y++) {
    const band = Math.floor(y / period);
    const base = (profile[y % period] ?? 0) * (gain[band] ?? 1);
    for (let x = 0; x < width; x++) {
      // A slow swell along the line and a little noise, as on real glass.
      const swell = 1 + 0.12 * Math.sin((x / width) * Math.PI * 4 + (phase[band] ?? 0));
      const noise = (random() - 0.5) * 0.06;
      const v = Math.round(Math.min(1, Math.max(0, base * swell + noise)) * 255);
      const i = (y * width + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return ctx.canvas.toDataURL("image/png");
}
