import { useEffect, useState } from "react";
import { SystemLabel } from "../../components/ui/terminal";
import { ipc, onTranscriptUpdated } from "../../lib/ipc";

/**
 * Reading mode — quiet, editorial, high readability.
 *
 * The counterpart to capture mode's density. The Markdown is rendered with a
 * small hand-written formatter rather than a library: notes only ever contain
 * the handful of constructs TRACE itself writes, and a full Markdown pipeline
 * would be a large dependency serving no purpose here.
 */
export function NoteScreen({ path, onBack }: { path: string; onBack: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refined, setRefined] = useState(false);

  useEffect(() => {
    void ipc
      .readNote(path)
      .then(setText)
      .catch((e) => setError(String(e)));
  }, [path]);

  // The note on screen may be superseded a minute or two later by the
  // higher-quality re-pass. Reload it in place rather than leaving the user
  // reading a version that is no longer what is on disk.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void onTranscriptUpdated((info) => {
      if (disposed || info.notePath !== path) return;
      void ipc.readNote(path).then((t) => {
        setText(t);
        setRefined(true);
      });
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [path]);

  return (
    <div data-mode="reading" className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="font-mono text-2xs uppercase tracking-system text-ink-faint transition-colors duration-120 hover:text-phosphor"
          >
            &lt; Meetings
          </button>
          <span aria-hidden className="trace-rule" />
        </div>

        {error && <p className="font-mono text-xs text-error">&gt; {error}</p>}
        {text === null && !error && (
          <p className="font-mono text-xs text-ink-faint">&gt; reading…</p>
        )}
        {refined && (
          <p className="font-mono text-2xs text-phosphor" role="status">
            &gt; transcript refined — full-quality pass complete.
          </p>
        )}
        {text !== null && <NoteBody markdown={text} />}

        {text !== null && (
          <p className="pt-6 font-mono text-2xs text-ink-faint" data-selectable>
            {path}
          </p>
        )}
      </div>
    </div>
  );
}

function NoteBody({ markdown }: { markdown: string }) {
  const { body } = splitFrontmatter(markdown);
  const blocks = body.split("\n\n").filter((b) => b.trim().length > 0);

  return (
    <article data-selectable className="flex flex-col gap-4">
      {blocks.map((block, i) => (
        // Blocks have no stable identity of their own; index is the honest key
        // for a static, non-reorderable rendering of a file's contents.
        // biome-ignore lint/suspicious/noArrayIndexKey: static document render
        <Block key={i} text={block.trim()} />
      ))}
    </article>
  );
}

function Block({ text }: { text: string }) {
  if (text.startsWith("# ")) {
    return <h1 className="text-2xl text-ink">{text.slice(2)}</h1>;
  }
  if (text.startsWith("## ")) {
    return (
      <div className="mt-4 flex items-center gap-2.5">
        <SystemLabel tone="muted">{text.slice(3)}</SystemLabel>
        <span aria-hidden className="trace-rule" />
      </div>
    );
  }
  if (text.startsWith("---")) {
    return <hr className="my-2 border-line" />;
  }

  const lines = text.split("\n");

  // Checkbox lists carry state the user can see at a glance, so they get
  // rendered as real checkboxes rather than literal bracket characters.
  if (lines.every((l) => l.startsWith("- ["))) {
    return (
      <ul className="flex flex-col gap-1.5">
        {lines.map((line) => {
          const done = line.startsWith("- [x]") || line.startsWith("- [X]");
          return (
            <li key={line} className="flex items-baseline gap-2 text-base">
              <span className={done ? "text-phosphor" : "text-ink-faint"}>{done ? "☑" : "☐"}</span>
              <span className={done ? "text-ink-muted line-through" : "text-ink"}>
                {line.replace(/^- \[[ xX]\] /, "")}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  if (lines.every((l) => l.startsWith("- "))) {
    return (
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-base text-ink marker:text-ink-faint">
        {lines.map((line) => (
          <li key={line}>{line.slice(2)}</li>
        ))}
      </ul>
    );
  }

  // Transcript lines: **you** `00:12` — text
  if (text.startsWith("**")) {
    const match = text.match(/^\*\*(.+?)\*\* `(.+?)` — ([\s\S]*)$/);
    if (match) {
      const [, speaker, time, said] = match;
      return (
        <p className="flex gap-3 font-mono text-xs">
          <span className="shrink-0 tabular-nums text-ink-faint">{time}</span>
          <span className="w-12 shrink-0 uppercase tracking-system text-phosphor-muted">
            {speaker}
          </span>
          <span className="text-ink">{said}</span>
        </p>
      );
    }
  }

  if (text.startsWith("*") && text.endsWith("*")) {
    return <p className="text-xs italic text-ink-faint">{text.replace(/^\*|\*$/g, "")}</p>;
  }

  return <p className="text-lg leading-relaxed text-ink">{text}</p>;
}

/** Split YAML frontmatter from the body. */
function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  if (!markdown.startsWith("---\n")) {
    return { frontmatter: "", body: markdown };
  }
  const end = markdown.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: "", body: markdown };

  return {
    frontmatter: markdown.slice(4, end),
    body: markdown.slice(end + 5),
  };
}
