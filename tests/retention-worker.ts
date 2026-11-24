import { personErasure } from "../src/person-erasure";
import { archiveTransfer } from "../src/ops/portability";
import { eraseMessage, sweepErasures } from "../src/ops/erasure";
import { snapshot } from "../src/snapshot";
import { restore } from "../staging/restore-worker";
import type { Bindings } from "../src/env";

// This isolated worker has no deployed route or credentials. Each operation runs against disposable bindings.
export default {
  async fetch(req: Request, env: Bindings & { RECOVERED: D1Database; TARGET: R2Bucket }) {
    const url = new URL(req.url);
    const owner = { kind: "user", id: "owner", role: "owner" } as const;
    const box = "00000000000000000000000001";
    if (url.pathname === "/import") return archiveTransfer(req, env, owner, box, undefined, url);
    if (url.pathname === "/erase-person") {
      const target = "00000000000000000000000003";
      return Response.json(
        await personErasure(
          env,
          { ...owner, id: "00000000000000000000000002" },
          { action: "erase", target, confirm: target, boxes: ["00000000000000000000000004"] },
        ),
      );
    }
    if (url.pathname === "/erase") {
      const id = await req.text();
      return Response.json(await eraseMessage(env, owner, box, id, id));
    }
    if (url.pathname === "/snapshot") await snapshot(env);
    else if (url.pathname === "/sweep") await sweepErasures(env);
    else if (url.pathname === "/restore")
      await restore({ SOURCE: env.MAIL, DB: env.RECOVERED, TARGET: env.TARGET });
    else return new Response(null, { status: 404 });
    return new Response(null, { status: 204 });
  },
};
