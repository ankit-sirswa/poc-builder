import { useEffect, useRef, useState, type MutableRefObject, type Ref } from "react";
import type { CredentialInfo } from "../api";

interface Props {
  id: string;
  label: string;
  placeholder: string;
  info: CredentialInfo;
  value: string;
  onChange: (value: string) => void;
  remember: boolean;
  onRememberChange: (remember: boolean) => void;
  onRemove: () => void;
  className?: string;
  error?: string | null;
  errorId?: string;
  inputRef?: Ref<HTMLInputElement>;
  noun: string;
  /** Saved/default status hasn't arrived yet. */
  loading?: boolean;
  /** Bump to switch to "use my own" mode and focus the input (e.g. after the current key was rejected). */
  promptSignal?: number;
}

/**
 * Secret input. A saved credential lives on the server and is shown masked;
 * a typed one goes to the server with the request (optionally saved there,
 * encrypted) and is never kept in browser storage.
 */
export function CredentialField({ id, label, placeholder, info, value, onChange, remember, onRememberChange, onRemove, className, error, errorId, inputRef, noun, loading, promptSignal }: Props) {
  const [reveal, setReveal] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const local = useRef<HTMLInputElement | null>(null);
  const setRefs = (el: HTMLInputElement | null) => {
    local.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef) (inputRef as MutableRefObject<HTMLInputElement | null>).current = el;
  };
  useEffect(() => {
    if (!promptSignal) return;
    setReplacing(true);
    requestAnimationFrame(() => local.current?.focus());
  }, [promptSignal]);
  const showSaved = info.saved && !replacing;
  const showDefault = !info.saved && !!info.hasDefault && !replacing;
  // A fresh save (or removal) ends replace mode.
  useEffect(() => setReplacing(false), [info.saved, info.savedAt]);
  const fallback = info.saved ? `Keep the saved ${noun}` : info.hasDefault ? "Use the server default" : null;

  return (
    <div className={className}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {loading ? (
        <div className="saved-key" id={id} role="status">
          <span>Checking saved {noun}…</span>
        </div>
      ) : showDefault ? (
        <div className="saved-key" id={id} role="group" aria-label={`Default ${noun}`}>
          <span className="check" aria-hidden="true">✓</span>
          <span>Using the server default</span>
          <span className="spacer" />
          <button className="text-button" type="button" onClick={() => setReplacing(true)}>
            Use my own
          </button>
        </div>
      ) : showSaved ? (
        <div className="saved-key" id={id} role="group" aria-label={`Saved ${noun}`}>
          <span className="check" aria-hidden="true">✓</span>
          <span>Saved on server</span>
          <span className="mono">•••• {info.last4}</span>
          <span className="spacer" />
          <button className="text-button" type="button" onClick={() => setReplacing(true)}>
            Replace
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              onRemove();
              setReplacing(false);
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <>
          <div className="credential-row">
            <input
              className="text-input credential-input"
              id={id}
              ref={setRefs}
              type={reveal ? "text" : "password"}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error && errorId ? errorId : undefined}
            />
            <button className="reveal-button" type="button" onClick={() => setReveal((v) => !v)} aria-label={`${reveal ? "Hide" : "Show"} ${noun}`}>
              {reveal ? "Hide" : "Show"}
            </button>
          </div>
          <label className="remember-row">
            <input type="checkbox" checked={remember} onChange={(event) => onRememberChange(event.target.checked)} />
            <span>Save on the server, encrypted, so I don't have to paste it again. You can remove it any time{info.hasDefault ? "; the server default is used again after that" : ""}.</span>
          </label>
          {fallback && (
            <button className="text-button" type="button" style={{ marginBottom: 12 }} onClick={() => { setReplacing(false); onChange(""); }}>
              {fallback}
            </button>
          )}
        </>
      )}
      {error && (
        <p className="field-error is-visible" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
