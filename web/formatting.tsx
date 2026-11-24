import { lazy, Suspense, useId } from "react";
import { textParts } from "../src/rich-text";
const RichEditor = lazy(() => import("./rich-editor"));
export function Formatting({
  rich,
  value,
  toggle,
  change,
}: {
  rich: boolean;
  value: string;
  toggle: (b: boolean) => void;
  change: (v: string) => void;
}) {
  const bodyId = useId();
  return (
    <>
      {rich ? (
        <div>
          <Suspense fallback={<p role="status">Opening formatted editor…</p>}>
            <RichEditor value={value} change={change} />
          </Suspense>
          <details>
            <summary>Preview formatting</summary>
            <div className="formatted-preview">
              {textParts(value).map((p) =>
                p.style === "strong" ? (
                  <strong key={p.start}>{p.text}</strong>
                ) : p.style === "em" ? (
                  <em key={p.start}>{p.text}</em>
                ) : (
                  p.text
                ),
              )}
            </div>
          </details>
        </div>
      ) : (
        <>
          <label htmlFor={bodyId}>Message</label>
          <textarea
            id={bodyId}
            value={value}
            maxLength={130000}
            rows={13}
            onChange={(e) => change(e.target.value)}
          />
        </>
      )}
      <label>
        <input type="checkbox" checked={rich} onChange={(e) => toggle(e.target.checked)} />{" "}
        Formatted message
      </label>
    </>
  );
}
