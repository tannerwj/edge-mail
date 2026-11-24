import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import * as z from "zod/mini";
export function RuleRecipient({ path, action }: { path: string; action: string }) {
  const targets = useQuery({
    queryKey: ["rule-targets", path],

    queryFn: async () =>
      z
        .object({
          people: z.array(z.object({ id: z.string(), email: z.string() })),
          hooks: z.array(z.object({ id: z.string(), host: z.string() })),
        })
        .parse(await api(path.replace(/rules$/, "rule-targets"))),
  });
  return (
    <label>
      {action === "notify" ? "Mailbox member" : "Registered webhook"}
      <select name="target" required>
        <option value="">Choose a recipient</option>
        {(action === "notify" ? targets.data?.people : targets.data?.hooks)?.map((t) => (
          <option key={t.id} value={t.id}>
            {"email" in t ? t.email : t.host}
          </option>
        ))}
      </select>
      {targets.error && <span role="alert">{targets.error.message}</span>}
    </label>
  );
}
