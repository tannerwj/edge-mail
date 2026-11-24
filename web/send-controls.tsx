import { useState } from "react";
import type { Box } from "./api";
export function SendControls({
  box,
  delay,
  setDelay,
  disabled,
  send,
}: {
  box: Box;
  delay: number;
  setDelay: (value: number) => void;
  disabled: boolean;
  send: (scheduledFor?: number) => Promise<void> | void;
}) {
  const [time, setTime] = useState("");
  return (
    <>
      {" "}
      {box.send_from && (
        <div className="compose-actions">
          <button
            type="button"
            disabled={disabled}
            title="Send (⌘ or Ctrl + Enter)"
            aria-keyshortcuts="Meta+Enter Control+Enter"
            onClick={() => void send()}
          >
            {box.capture ? "Send to capture" : "Send"}
          </button>
          <details className="send-options">
            <summary>Send later</summary>
            <div>
              <label>
                Send at (local time)
                <input
                  type="datetime-local"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={disabled || !time}
                onClick={() => void send(new Date(time).getTime())}
              >
                Schedule send
              </button>
              <label>
                Undo window
                <select value={delay} onChange={(e) => setDelay(Number(e.target.value))}>
                  {[5, 10, 20, 30].map((n) => (
                    <option key={n} value={n}>
                      {n} seconds
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </div>
      )}
    </>
  );
}
