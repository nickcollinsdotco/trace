import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { ipc, isDesktop } from "./lib/ipc";
import "./design/index.css";

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

function mount() {
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
