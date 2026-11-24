// Run the installed Claude Code MCP client against disposable mail. Only the model's tool selection is scripted.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
function reply(res, block, stream, model) {
  const stop = block.type === "tool_use" ? "tool_use" : "end_turn";
  const base = {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  if (!stream) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ...base, content: [block], stop_reason: stop }));
    return;
  }
  res.setHeader("content-type", "text/event-stream");
  const event = (type, fields) =>
    res.write("event: " + type + "\ndata: " + JSON.stringify({ type, ...fields }) + "\n\n");
  event("message_start", { message: base });
  const tool = block.type === "tool_use";
  event("content_block_start", {
    index: 0,
    content_block: tool ? { ...block, input: {} } : { type: "text", text: "" },
  });
  event("content_block_delta", {
    index: 0,
    delta: tool
      ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
      : { type: "text_delta", text: block.text },
  });
  event("content_block_stop", { index: 0 });
  event("message_delta", {
    delta: { stop_reason: stop, stop_sequence: null },
    usage: { output_tokens: 1 },
  });
  event("message_stop", {});
  res.end();
}
export async function runClaudeFixture(origin, key, code) {
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  const dir = await mkdtemp(join(tmpdir(), "edge-mail-claude-"));
  let observed,
    issued = 0;
  async function serve(req, res) {
    if (!req.url.startsWith("/v1/messages")) {
      res.statusCode = 404;
      res.end();
      return;
    }
    let text = "";
    for await (const chunk of req) text += chunk;
    const b = JSON.parse(text);
    if (req.url.includes("count_tokens")) {
      res.setHeader("content-type", "application/json");
      res.end('{"input_tokens":10}');
      return;
    }
    const outputs = b.messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((x) => x.type === "tool_result" && x.tool_use_id === "toolu_filing");
    if (outputs.length) {
      const parts = outputs[0].content;
      const raw = typeof parts === "string" ? parts : parts.find((x) => x.type === "text")?.text;
      try {
        observed = JSON.parse(raw);
      } catch {
        observed = { isError: true };
      }
      reply(res, { type: "text", text: "Fixture finished." }, b.stream, b.model);
      return;
    }
    const tool = b.tools?.find((t) => t.name === "mcp__mail__execute");
    if (!tool || issued) {
      reply(res, { type: "text", text: "Mail tool unavailable." }, b.stream, b.model);
      return;
    }
    issued++;
    reply(
      res,
      { type: "tool_use", id: "toolu_filing", name: tool.name, input: { code } },
      b.stream,
      b.model,
    );
  }
  const model = createServer((req, res) => {
    void serve(req, res).catch(() => {
      res.statusCode = 500;
      res.end();
    });
  });
  try {
    model.listen(0, "127.0.0.1");
    await once(model, "listening");
    const config = JSON.stringify({
      mcpServers: {
        mail: {
          type: "http",
          url: origin + "/mcp",
          headers: { Authorization: "Bearer ${EDGE_MAIL_FIXTURE_TOKEN}" },
        },
      },
    });
    const configFile = join(dir, "mcp.json");
    await writeFile(configFile, config, { mode: 0o600 });
    const proc = spawn(
      "claude",
      [
        "-p",
        "File the 200 synthetic messages using the requested mail operation.",
        "--bare",
        "--strict-mcp-config",
        "--mcp-config",
        configFile,
        "--tools",
        "",
        "--allowedTools",
        "mcp__mail__execute",
        "--no-session-persistence",
        "--model",
        "claude-sonnet-4-6",
        "--setting-sources",
        "",
        "--max-turns",
        "3",
      ],
      {
        cwd: dir,
        env: {
          PATH: process.env.PATH,
          EDGE_MAIL_FIXTURE_TOKEN: key,
          HOME: dir,
          TMPDIR: tmpdir(),
          CLAUDE_CONFIG_DIR: dir,
          ANTHROPIC_API_KEY: "local-fixture",
          ANTHROPIC_BASE_URL: "http://127.0.0.1:" + model.address().port,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          ENABLE_TOOL_SEARCH: "false",
        },
        stdio: ["ignore", "ignore", "pipe"],
        signal: AbortSignal.timeout(60000),
      },
    );
    proc.stderr.resume();

    const [exit] = await once(proc, "exit");
    assert.equal(exit, 0, "Claude Code fixture client failed");
    assert.equal(issued, 1, "Claude Code did not discover the execute tool");
    assert.ok(observed && !observed.isError, "Claude Code must return the backend tool result");
    return observed;
  } finally {
    model.closeAllConnections();
    model.close();
    await rm(dir, { recursive: true, force: true });
  }
}
