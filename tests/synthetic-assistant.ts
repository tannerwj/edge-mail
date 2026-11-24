import type { Bindings } from "../src/env";
export const syntheticAssistant: NonNullable<Bindings["AI"]> = {
  async run(_model, { messages, max_tokens }) {
    if (
      max_tokens > 350 ||
      messages.length !== 2 ||
      messages[0].role !== "system" ||
      messages[1].role !== "user"
    )
      throw Error("Invalid model boundary");
    if (messages[0].content.startsWith("Return only an Edge Mail"))
      return { response: "subject:Delivery" };
    if (messages[0].content.startsWith("Suggest a mailbox label"))
      return { response: '{"field":"subject","value":"Receipt","label":"Receipts"}' };
    if (
      !JSON.parse(messages[1].content).some((m: { text: string }) =>
        m.text.includes("delivery window"),
      )
    )
      throw Error("Expected the selected fictional conversation");
    if (messages[0].content.startsWith("Return exactly one")) return { response: "Updates" };
    return { response: "The sender asks about a delivery window." };
  },
};
