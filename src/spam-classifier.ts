import { createHash } from "node:crypto";

export function features(subject: string, body: string, sender: string) {
  const unique = new Set<string>();
  const append = (prefix: string, input: string, cap: number) => {
    const words =
      input
        .slice(0, 8192)
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}]{2,40}/gu) || [];
    for (const word of words) {
      if (unique.size >= cap) break;
      unique.add(prefix + word);
    }
  };
  append("from:", sender.split("@").at(-1) || "", 8);
  append("subject:", subject, 40);
  append("body:", body, 128);
  return [...unique].map((word) => createHash("sha256").update(word).digest("hex").slice(0, 32));
}
type Counts = { spam: number; ham: number };
export function classify(totals: Counts, matches: Counts[]) {
  if (Math.min(totals.spam, totals.ham) < 4) return 0.5;
  // Equal priors avoid treating an imbalanced feedback queue as an estimate of incoming prevalence.
  const strongest = matches
    .map((row) => Math.log((row.spam + 1) / (totals.spam + 2) / ((row.ham + 1) / (totals.ham + 2))))
    .sort((a, b) => Math.abs(b) - Math.abs(a))
    .slice(0, 12);
  return 1 / (1 + Math.exp(-strongest.reduce((sum, n) => sum + n, 0)));
}
