import React, { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import * as z from "zod/mini";
import { api } from "./api";
const ticket = z.object({
  href: z.nullable(z.string()),
  count: z.optional(z.number()),
  showing: z.optional(z.boolean()),
  trusted: z.optional(z.boolean()),
  verified: z.optional(z.boolean()),
});
export function FormattedBody({
  box,
  id,
  enabled,
  text,
}: {
  box: string;
  id: string;
  enabled: boolean;
  text: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(180),
    [destination, setDestination] = useState("");
  const signed = useMutation({
    mutationFn: async (images?: "once" | "always" | "block") =>
      ticket.parse(
        await api(
          "mailboxes/" + box + (images === "once" ? "/images/" : "/formatted/") + id,
          images && images !== "once" ? { images } : undefined,
        ),
      ),
  });
  const href = signed.data?.href;
  useEffect(() => {
    const message = (event: MessageEvent) => {
      if (event.origin !== "null" || event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (data?.kind === "mail-height" && Number.isFinite(data.height))
        setHeight(Math.max(80, Math.min(2400, data.height + 8)));
      if (data?.kind === "mail-link" && typeof data.href === "string") {
        try {
          const url = new URL(data.href);
          if (["http:", "https:", "mailto:"].includes(url.protocol)) setDestination(url.href);
        } catch {
          /* Ignore unusable links. */
        }
      }
    };
    if (href) window.addEventListener("message", message);
    return () => window.removeEventListener("message", message);
  }, [href]);
  return (
    <>
      {enabled && signed.data?.href !== null && (
        <button
          className="body-switch"
          disabled={signed.isPending}
          onClick={() => {
            setDestination("");
            if (href) signed.reset();
            else signed.mutate(undefined);
          }}
        >
          {href ? "Show plain text" : "Show formatted message"}
        </button>
      )}
      {href && !!signed.data?.count && (
        <div className="image-settings">
          {!signed.data.showing && (
            <button disabled={signed.isPending} onClick={() => signed.mutate("once")}>
              Load images for this message
            </button>
          )}
          {signed.data.verified && !signed.data.trusted && (
            <button disabled={signed.isPending} onClick={() => signed.mutate("always")}>
              Always show images from this sender
            </button>
          )}
          {signed.data.showing && (
            <button disabled={signed.isPending} onClick={() => signed.mutate("block")}>
              {signed.data.trusted ? "Stop showing this sender’s images" : "Hide remote images"}
            </button>
          )}
        </div>
      )}
      {signed.error && <p role="alert">{signed.error.message}</p>}
      {href ? (
        <iframe
          className="formatted-body"
          title="Formatted message"
          ref={frame}
          height={height}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          src={href}
        />
      ) : (
        <PlainBody text={text} />
      )}
      {destination && (
        <p>
          Open link{" "}
          <a href={destination} target="_blank" rel="noopener noreferrer">
            {destination}
          </a>
        </p>
      )}
    </>
  );
}

function PlainBody({ text }: { text: string }) {
  // Only collapse a continuous quoted suffix. Inline answers stay readable.
  const lines = text.trimEnd().split("\n");
  let first = lines.length;
  while (first > 0 && lines[first - 1].trimStart().startsWith(">")) first--;
  if (lines.length - first < 2) return <div className="body">{text}</div>;
  return (
    <>
      <div className="body">{lines.slice(0, first).join("\n")}</div>
      <details>
        <summary>Show quoted text</summary>
        <div className="body">{lines.slice(first).join("\n")}</div>
      </details>
    </>
  );
}
