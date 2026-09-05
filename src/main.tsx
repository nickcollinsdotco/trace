import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./design/index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("TRACE: #root missing from index.html");
}

const reactRoot = ReactDOM.createRoot(root);

/**
 * `#gallery` opens the fixture harness instead of the app.
 *
 * Guarded on `import.meta.env.DEV` and loaded dynamically, so the fixtures and
 * their sample transcripts are never bundled into a shipped build.
 */
const isGallery = () => import.meta.env.DEV && location.hash.startsWith("#gallery");

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

if (import.meta.env.DEV) {
  let wasGallery = isGallery();
  window.addEventListener("hashchange", () => {
    // Only remount when crossing the boundary; the gallery owns its own hash
    // for scenario selection and must not be torn down on every click.
    if (isGallery() !== wasGallery) {
      wasGallery = isGallery();
      mount();
    }
  });
}

mount();
