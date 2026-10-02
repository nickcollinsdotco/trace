import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Prompt, SystemLabel } from "./terminal";

/**
 * Asking before something that cannot be undone, in the app's own voice.
 *
 * These were `window.confirm`, which WebView2 draws as a system box titled
 * "tauri.localhost says" — the one screen in the app that looked like a web
 * page, and at exactly the moment the user most needs to trust what they
 * are reading.
 *
 * Only for confirmations. Rename is inline (docs/13-DESIGN-UPGRADES.md): a
 * dialog is right when interrupting is the point, and a rename is not that.
 */
export interface ConfirmOptions {
  title: string;
  /** Paragraphs. The consequence goes here, stated plainly. */
  body?: string[];
  /** The verb, e.g. "Delete meeting". Never "OK". */
  confirm: string;
  /** Destructive actions are red, and focus starts on Cancel. */
  danger?: boolean;
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

/**
 * The function that asks.
 *
 * Outside a provider it falls back to the native box rather than throwing,
 * so a screen rendered on its own still asks instead of acting unasked.
 */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  return ask ?? nativeConfirm;
}

async function nativeConfirm(o: ConfirmOptions): Promise<boolean> {
  return window.confirm([o.title, ...(o.body ?? [])].join("\n\n"));
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{
    options: ConfirmOptions;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const ask = useCallback<Ask>(
    (options) => new Promise<boolean>((resolve) => setPending({ options, resolve })),
    [],
  );

  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && <ConfirmDialog options={pending.options} onSettle={settle} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  options,
  onSettle,
}: {
  options: ConfirmOptions;
  onSettle: (ok: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const accept = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    // Modal, so the page behind is inert and Escape cancels. jsdom has no
    // showModal; there the dialog simply opens in place.
    if (typeof el.showModal === "function") el.showModal();
    else el.setAttribute("open", "");
    // Focus on the safe answer when the other one destroys something.
    (options.danger ? cancel : accept).current?.focus();
  }, [options.danger]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="trace-confirm-title"
      // Escape. Prevented so React unmounts the dialog, rather than the
      // browser closing it underneath React.
      onCancel={(e) => {
        e.preventDefault();
        onSettle(false);
      }}
      className="trace-dialog m-auto w-[min(28rem,calc(100vw-2rem))] rounded-md border border-line-strong bg-surface-1 p-0 text-ink shadow-(--elevation-overlay)"
    >
      <div className="flex flex-col gap-4 p-5">
        <SystemLabel tone={options.danger ? "error" : "muted"}>Confirm</SystemLabel>
        <h2 id="trace-confirm-title" className="trace-title text-lg text-ink">
          {options.title}
        </h2>
        {options.body?.map((p) => (
          <p key={p} className="text-sm text-ink-muted">
            {p}
          </p>
        ))}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            ref={cancel}
            type="button"
            onClick={() => onSettle(false)}
            className="trace-btn trace-btn-quiet text-ink-muted trace-press hover:text-ink"
          >
            Cancel
          </button>
          <button
            ref={accept}
            type="button"
            onClick={() => onSettle(true)}
            className={`trace-btn trace-press ${
              options.danger
                ? "border-error bg-error-dim text-error hover:bg-error hover:text-surface-0"
                : "border-phosphor bg-phosphor-dim text-phosphor hover:bg-phosphor hover:text-surface-0"
            }`}
          >
            <Prompt />
            {options.confirm}
          </button>
        </div>
      </div>
    </dialog>
  );
}
