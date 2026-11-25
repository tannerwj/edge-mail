import { useState } from "react";
export function TimePresets({ choose }: { choose: (v: string) => void }) {
  const [now] = useState(() => new Date()),
    later = new Date(now.getTime() + 2 * 3600000),
    tomorrow = new Date(now),
    nextWeek = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  nextWeek.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  nextWeek.setHours(9, 0, 0, 0);
  const choices: [string, Date][] = [
    ["Tomorrow morning", tomorrow],
    ["Next week", nextWeek],
  ];
  if (later.toDateString() === now.toDateString()) choices.unshift(["Later today", later]);
  return (
    <div className="time-presets">
      {choices.map(([label, time]) => (
        <button
          type="button"
          key={label}
          onClick={() =>
            choose(
              new Date(time.getTime() - time.getTimezoneOffset() * 60000)
                .toISOString()
                .slice(0, 16),
            )
          }
        >
          {label}
          <small>
            {time.toLocaleString(undefined, {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            })}
          </small>
        </button>
      ))}
    </div>
  );
}
