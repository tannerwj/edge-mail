// Fixed model arithmetic catches inverted evidence and token frequency amplification that UI journeys cannot.
import assert from "node:assert/strict";
import { features, classify } from "../src/spam-classifier.ts";
const totals = { spam: 8, ham: 8 };
const example = [
  { token: "a", spam: 8, ham: 1 },
  { token: "b", spam: 8, ham: 0 },
];
// Balanced classes, add-one smoothing: odds = (9/2)*(9/1) = 40.5.
assert.ok(Math.abs(classify(totals, example) - 40.5 / 41.5) < 1e-10);
assert.equal(classify({ spam: 0, ham: 3 }, example), 0.5);
assert.equal(classify(totals, []), 0.5);
const corpus = {
  spam: [
    "prize winner jackpot",
    "jackpot bonus prize",
    "winner prize voucher",
    "bonus winner jackpot",
  ],
  ham: [
    "family dinner appointment",
    "appointment budget meeting",
    "meeting family dinner",
    "budget meeting dinner",
  ],
};
const model = new Map();
for (const [label, samples] of Object.entries(corpus))
  for (const text of samples) {
    for (const token of features("", text, "")) {
      const row = model.get(token) || { token, spam: 0, ham: 0 };
      row[label]++;
      model.set(token, row);
    }
  }
const score = (text) =>
  classify(
    { spam: 4, ham: 4 },
    features("", text, "")
      .map((k) => model.get(k))
      .filter(Boolean),
  );
assert.ok(score("winner bonus prize") > 0.95);
assert.ok(score("family dinner meeting") < 0.05);
assert.equal(score("unknown"), 0.5);
assert.deepEqual(features("", "ÉCOLE école École", ""), features("", "école", ""));
assert.equal(features("", "win ".repeat(1000), "").length, 1);
assert.ok(
  features("", Array.from({ length: 2000 }, (_, i) => "item" + i).join(" "), "").length <= 128,
);
console.log(
  "PASS · fixed spam and ham corpus, neutral cold start, hand-calculated evidence, bounded unique features",
);
