import { useEffect, useState } from "react";
import { formatBytes } from "../../lib/format";
import { type AudioBeyond, type AudioRetention, hasBackend, ipc } from "../../lib/ipc";

const DEFAULT_LATEST = 5;

/**
 * What happens to a meeting's audio once its notes are written.
 *
 * Shared by Settings and the recording setup panel. It belongs on the setup
 * panel too because it is a decision about the meeting about to be recorded,
 * and it costs real disk — roughly 690 MB per hour of dual-stream capture.
 * Stating the figure is the point; "keep audio" without it is a choice made
 * blind.
 *
 * Shows what the backend stored rather than what was clicked, so a failed
 * write cannot leave the control claiming something that is not true.
 */
export function AudioRetentionField() {
  const [value, setValue] = useState<AudioRetention | null>(null);
  const [count, setCount] = useState(DEFAULT_LATEST);
  const [beyond, setBeyond] = useState<AudioBeyond | null>(null);
  const [freed, setFreed] = useState<AudioBeyond | null>(null);

  const measure = () =>
    void ipc
      .audioBeyondRetention()
      .then(setBeyond)
      .catch(() => setBeyond(null));

  useEffect(() => {
    if (!hasBackend()) return;
    void ipc
      .getSettings()
      .then((s) => {
        setValue(s.audioRetention);
        if (s.audioRetention.mode === "keep_latest") setCount(s.audioRetention.count);
      })
      .catch(() => setValue({ mode: "delete" }));
    void ipc
      .audioBeyondRetention()
      .then(setBeyond)
      .catch(() => {});
  }, []);

  if (value === null) return null;

  const store = (next: AudioRetention) =>
    void ipc
      .setAudioRetention(next)
      .then((s) => {
        setValue(s.audioRetention);
        setFreed(null);
        measure();
      })
      .catch(() => {});

  // Offered, never done with the setting: lowering it says what it no
  // longer keeps, and the audio goes only when asked. The count is typed a
  // digit at a time, so applying it as it changed would delete on the way.
  const release = () =>
    void ipc
      .releaseAudioBeyondRetention()
      .then((f) => {
        setFreed(f);
        measure();
      })
      .catch(() => {});

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Keep audio"
          value={value.mode}
          onChange={(e) => {
            const mode = e.target.value as AudioRetention["mode"];
            store(mode === "keep_latest" ? { mode, count } : { mode });
          }}
          className="trace-field w-auto py-1.5 text-sm"
        >
          <option value="delete">Delete once notes are written</option>
          <option value="keep_latest">Keep for the latest meetings</option>
          <option value="keep_all">Keep for every meeting</option>
        </select>
        {value.mode === "keep_latest" && (
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="number"
              min={1}
              max={50}
              value={count}
              aria-label="Number of meetings to keep audio for"
              onChange={(e) => {
                const n = Math.min(50, Math.max(1, Number(e.target.value) || 1));
                setCount(n);
                store({ mode: "keep_latest", count: n });
              }}
              className="trace-field w-16 py-1.5 text-sm tabular-nums"
            />
            meetings
          </label>
        )}
      </div>
      {beyond && beyond.meetings > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink-muted">
            {beyond.meetings} earlier {beyond.meetings === 1 ? "meeting has" : "meetings have"}{" "}
            audio this no longer keeps, {formatBytes(beyond.bytes)}.
          </p>
          <button
            type="button"
            onClick={release}
            className="trace-btn trace-btn-secondary trace-press"
          >
            Delete it
          </button>
        </div>
      )}
      {freed && freed.meetings > 0 && (
        <p className="text-sm text-ink-muted">
          Deleted {formatBytes(freed.bytes)} of audio. Notes and transcripts are kept.
        </p>
      )}
      <p className="text-2xs text-ink-faint">
        About 690 MB per hour. Keeping some makes transcription problems fixable; notes and
        transcripts are kept either way.
      </p>
    </div>
  );
}
