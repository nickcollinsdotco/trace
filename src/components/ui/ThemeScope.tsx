import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { applyTheme, type Overrides, type Theme } from "../../design/theme";

/**
 * Anything, shown in another theme than the page's — a preview.
 *
 * Inside a shadow root, because a theme's rules are written against its
 * ancestors: `[data-theme="teletext"] .trace-section-head` paints every
 * section head below the page's root blue, a preview's included, and the
 * same goes for every frame, family, capitals and field rule. A preview
 * that set its own attributes still wore half the page's theme — and
 * Carbon, being no attribute at all, wore all of it. Selectors do not
 * cross into a shadow root; custom properties do, by inheritance, but
 * Tailwind sets every token's default on `:host` as well as `:root`, so a
 * preview starts from Carbon and takes only its own theme.
 *
 * The app's stylesheets are copied into one constructed sheet, once, and
 * shared by every preview. In development a style changed by hot reload
 * reaches previews only on a full reload.
 */
export function ThemeScope({
  theme,
  overrides = {},
  className = "",
  children,
}: {
  theme: Theme;
  overrides?: Overrides | undefined;
  /** For the host: its size and place in the page. */
  className?: string;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const sheet = sharedSheet();
    if (!sheet || typeof el.attachShadow !== "function") {
      // No shadow DOM to be had (tests): render in place, unisolated.
      setRoot(el);
      return;
    }
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    shadow.adoptedStyleSheets = [sheet];
    let inner = shadow.firstElementChild as HTMLElement | null;
    if (!inner) {
      inner = document.createElement("div");
      // The theme's own ink, not the page's, for anything not given one.
      inner.style.color = "var(--color-ink)";
      inner.style.height = "100%";
      shadow.append(inner);
    }
    setRoot(inner);
  }, []);

  useEffect(() => {
    if (root) applyTheme(theme, root, overrides);
  }, [root, theme, overrides]);

  return (
    <div ref={host} className={className}>
      {root && createPortal(children, root)}
    </div>
  );
}

let cached: CSSStyleSheet | null | undefined;

/** The page's styles as one constructed sheet, or null where that cannot be. */
function sharedSheet(): CSSStyleSheet | null {
  if (cached !== undefined) return cached;
  if (
    typeof CSSStyleSheet === "undefined" ||
    !("replaceSync" in CSSStyleSheet.prototype) ||
    !("adoptedStyleSheets" in Document.prototype)
  ) {
    cached = null;
    return cached;
  }
  const text: string[] = [];
  for (const s of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(s.cssRules)) text.push(rule.cssText);
    } catch {
      // A stylesheet from another origin cannot be read; TRACE has none.
    }
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text.join("\n"));
  cached = sheet;
  return cached;
}
