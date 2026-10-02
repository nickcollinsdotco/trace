import { ThemeScope } from "../components/ui/ThemeScope";
import { THEME_FAMILY, THEME_NOTES, THEMES } from "../design/theme";
import { ThemeSample } from "../features/appearance/ThemeSample";

/**
 * Every theme at once, as a photographer's contact sheet: the same sample
 * in each, side by side, so they are compared with each other rather than
 * remembered one at a time. Each in its own scope (ThemeScope), so none
 * borrows from the gallery's theme.
 *
 * Shown bare, without the app's shell.
 */
export function ContactSheet() {
  return (
    <div className="h-full overflow-y-auto bg-[#0e0e10] p-6">
      <div className="mb-5 flex items-baseline gap-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/50">
          Contact sheet · {THEMES.length} themes
        </p>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {THEMES.map((theme, i) => (
          <figure key={theme} className="m-0 flex break-inside-avoid flex-col gap-2">
            <ThemeScope theme={theme} className="overflow-hidden rounded-md border border-white/10">
              <ThemeSample />
            </ThemeScope>
            <figcaption className="flex items-baseline gap-2 font-mono text-[11px] text-white/60">
              <span className="shrink-0 whitespace-nowrap text-white/90">
                {(i + 1) % 10} {theme}
              </span>
              <span className="shrink-0">{THEME_FAMILY[theme]}</span>
              <span className="truncate text-white/40">{THEME_NOTES[theme]}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
