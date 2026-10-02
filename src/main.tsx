import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { currentAdjustments, loadAppearance } from "./design/appearance";
import { installTextures } from "./design/textures";
import { applyTheme } from "./design/theme";
import { MiniWindow } from "./features/mini/MiniWindow";
import { ipc, isDesktop } from "./lib/ipc";
import "./design/index.css";

// Before the first render, so a screen effect is never drawn without its
// texture for a frame.
installTextures();

const root = document.getElementById("root");
if (!root) {
  throw new Error("TRACE: #root missing from index.html");
}

const reactRoot = ReactDOM.createRoot(root);

/**
 * `#gallery` opens the screen gallery instead of the app.
 *
 * It ships in every build now (docs/13-DESIGN-UPGRADES.md) so themes can be
 * judged in the installed app, not only in dev. Loaded dynamically, so the
 * fixtures and their sample transcripts cost the app nothing until it is
 * opened: they are a chunk of their own, fetched on demand.
 */
const isGallery = () => location.hash.startsWith("#gallery");
const isMini = () => location.hash.startsWith("#mini");

/**
 * The mini window wears the main window's theme. They share storage, so a
 * theme picked in one reaches the other through the storage event.
 */
function themeMini() {
  const a = loadAppearance();
  applyTheme(a.theme, document.documentElement, currentAdjustments(a));
}

function mount() {
  if (isMini()) {
    // A transparent window: only what the mini window draws is seen.
    document.documentElement.dataset.window = "mini";
    themeMini();
    window.addEventListener("storage", themeMini);
    reactRoot.render(
      <React.StrictMode>
        <MiniWindow />
      </React.StrictMode>,
    );
    return;
  }

  if (isGallery()) {
    void import("./fixtures/Gallery").then(({ Gallery }) => {
      reactRoot.render(
        <React.StrictMode>
          <Gallery />
        </React.StrictMode>,
      );
    });
    return;
  }

  reactRoot.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

/*
 * Ctrl+Shift+G. In the desktop app it opens the gallery in a window of its
 * own, because the gallery fakes the backend for the whole page it runs in.
 * In a plain browser (`pnpm dev`) there is only one page and no real backend
 * to protect, so it flips the hash as it always did.
 */
window.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== "g") return;
  e.preventDefault();
  if (isDesktop()) {
    if (!isGallery()) void ipc.openGallery().catch(() => {});
    return;
  }
  location.hash = isGallery() ? "" : "gallery";
});

let wasGallery = isGallery();
window.addEventListener("hashchange", () => {
  // Only remount when crossing the boundary; the gallery owns its own hash
  // for scenario selection and must not be torn down on every click.
  if (isGallery() !== wasGallery) {
    wasGallery = isGallery();
    mount();
  }
});

mount();
