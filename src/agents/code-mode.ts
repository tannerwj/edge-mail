import { RpcTarget } from "cloudflare:workers";
import { createHash } from "node:crypto";
import * as z from "zod/mini";
import { Problem, type Bindings } from "../env";
import { type Credential, permits } from "./grants";
import { catalog } from "./catalog";
import { executeOperation } from "./operations";

const maxBytes = 262144;
const size = (input: unknown) => new TextEncoder().encode(JSON.stringify(input)).length;
type Run = {
  calls: number;
  active: number;
  writing: boolean;
  closed: boolean;
  completions: string[];
  pending: Set<Promise<unknown>>;
};
const argsSchema = z.record(z.string(), z.unknown());
class MailBridge extends RpcTarget {
  #invoke: (name: string, args: unknown) => Promise<unknown>;
  constructor(dispatch: (name: string, args: unknown) => Promise<unknown>) {
    super();
    this.#invoke = dispatch;
  }
  async callTool(name: string, args: unknown) {
    return this.#invoke(name, args);
  }
}
function invoke(
  env: Bindings,
  c: Credential,
  state: Run,
  dry: boolean,
  name: string,
  args: unknown,
) {
  if (state.closed || state.calls >= 25 || state.active >= 4)
    throw new Problem(429, "Execution limit reached");
  const op = catalog.find((e) => e.name === name);
  if (!op || !permits(c.scopes, op.scope)) throw new Problem(403, "Operation unavailable");
  if (op.write && state.writing)
    throw new Problem(409, "Await each write before starting the next");
  if (size(args) > 65536) throw new Problem(413, "Operation arguments exceed 64 KiB");
  const input = argsSchema.parse(args);
  state.calls++;
  state.active++;
  if (op.write) state.writing = true;
  const pending = executeOperation(env, c, name, input, dry)
    .then((result) => {
      if (op.write && !dry && input.dry_run !== true) state.completions.push(name);
      if (size(result) > maxBytes) throw new Problem(413, "Operation result exceeds 256 KiB");
      return result;
    })
    .finally(() => {
      state.active--;
      if (op.write) state.writing = false;
      state.pending.delete(pending);
    });
  state.pending.add(pending);
  return pending;
}
const harness = `
import {WorkerEntrypoint} from "cloudflare:workers";
import run from "./snippet.js";
export default class MailProgram extends WorkerEntrypoint {
  async evaluate(mode,bridge,operations){
    const logs=[];let used=0;
    const log=(...values)=>{if(logs.length>=50 || used>=8192)return;const line=values.map(v=>typeof v==="string"?v:JSON.stringify(v)).join(" ").slice(0,8192-used);used+=line.length;logs.push(line);};
    const console=Object.freeze({log,info:log,warn:log,error:log});
    const mail=bridge?new Proxy(Object.create(null),{get:(_,key)=>typeof key==="string" && key!=="then" ? (args={})=>bridge.callTool(key,args):undefined}):undefined;
    try{
      const result=await run(mail,operations,console);
      const text=JSON.stringify({result:result??null,logs});
      if(new TextEncoder().encode(text).length>262144)throw Error("Result exceeds 256 KiB");
      return {ok:true,text};
    }catch(e){return {ok:false,text:String(e?.message||"Program failed").slice(0,1000)};}
  }
}`;
const outcome = z.object({ ok: z.boolean(), text: z.string() });
export async function runCode(
  env: Bindings,
  c: Credential,
  mode: "search" | "execute",
  input: Record<string, unknown>,
) {
  const code = input.code;
  if (typeof code !== "string" || !code.trim() || new TextEncoder().encode(code).length > 16384)
    throw new Problem(400, "Provide up to 16 KiB of code");
  const entries = catalog
    .filter((e) => permits(c.scopes, e.scope))
    .map((e) => ({
      ...e,
      access: e.write ? "write" : "read",
      signature: "mail." + e.name + "({" + e.fields.join(",") + "})",
      input: e.fields,
    }));
  const state: Run = {
    calls: 0,
    active: 0,
    writing: false,
    closed: false,
    completions: [],
    pending: new Set(),
  };
  const bridge =
    mode === "search"
      ? null
      : new MailBridge((name, args) => invoke(env, c, state, input.dry_run === true, name, args));
  const id = createHash("sha256").update(mode).update("\0").update(code).digest("hex");
  await env.DB.prepare(
    "INSERT INTO agent_code_usage(day,digest,calls) VALUES(date('now'),?,1) ON CONFLICT(day,digest) DO UPDATE SET calls=calls+1",
  )
    .bind(id)
    .run();
  // A fresh isolate prevents a cached snippet from retaining mail between grants or invocations.
  const worker = env.LOADER.load({
    compatibilityDate: "2026-11-19",
    mainModule: "main.js",
    modules: {
      "main.js": harness,
      "snippet.js":
        "export default async function(mail,operations,console){return await (" +
        code +
        ")(mail,operations,console);}",
    },
    globalOutbound: null,
    limits: { cpuMs: 1000, subRequests: 26 },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const entry = worker.getEntrypoint(),
      method = Reflect.get(Object(entry), "evaluate");
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        state.closed = true;
        reject(Error("30 second execution limit"));
      }, 30000);
    });
    const out = outcome.parse(
      await Promise.race([Reflect.apply(method, entry, [mode, bridge, entries]), deadline]),
    );
    if (!out.ok) throw Error(out.text);
    return { isError: false, ...JSON.parse(out.text), calls: state.calls };
  } catch (e) {
    return {
      isError: true,
      error: e instanceof Error ? e.message : "Execution failed",
      calls: state.calls,
      completed_writes: state.completions,
    };
  } finally {
    state.closed = true;
    clearTimeout(timer);
    await Promise.allSettled(state.pending);
  }
}
