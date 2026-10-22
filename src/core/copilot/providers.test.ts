import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANTHROPIC_TOOLS,
  anthropicRequest,
  closeOpenCalls,
  explainProviderError,
  OPENAI_TOOLS,
  openAiRequest,
  parseAnthropic,
  parseOpenAi,
  trimTranscript,
  type Turn,
} from "./providers";
import { COPILOT_TOOLS, type CopilotContext } from "./tools";

const ctx: CopilotContext = {
  bones: ["root", "hips", "head"],
  parts: ["body", "head"],
  clips: ["idle", "strike"],
  ikNames: [],
  activeClip: "strike",
  selectedBone: "head",
  selectedPart: null,
  currentTime: 0.25,
  duration: 2,
  fps: 24,
  loop: false,
  suggestions: [{ id: "squash", principle: "Squash & stretch", title: "No squash on impact", fixable: true }],
};

const convo: Turn[] = [
  { role: "user", text: "tilt the head" },
  { role: "assistant", text: "Tilting.", calls: [{ id: "toolu_1", tool: "set_key", args: { bones: ["head"], r: 10 } }] },
  { role: "tool", results: [{ id: "toolu_1", ok: true, message: "Keyed head at frame 6" }] },
  { role: "assistant", text: "Done.", calls: [] },
  { role: "user", text: "more" },
];

describe("tool catalog", () => {
  it("is valid for Claude and OpenAI tool use", () => {
    const names = new Set<string>();
    for (const t of COPILOT_TOOLS) {
      assert.match(t.name, /^[a-zA-Z0-9_-]{1,64}$/);
      assert.ok(!names.has(t.name), `duplicate ${t.name}`);
      names.add(t.name);
      assert.ok(t.description.length > 10, `${t.name} needs a description`);
      assert.equal(t.input.type, "object");
      for (const r of t.input.required ?? []) assert.ok(r in t.input.properties, `${t.name}: required ${r} is not a property`);
      for (const [p, schema] of Object.entries(t.input.properties)) {
        assert.ok(typeof schema.type === "string", `${t.name}.${p} has no type`);
        assert.ok(typeof schema.description === "string" && schema.description.length > 0, `${t.name}.${p} has no description`);
        if (schema.enum) assert.ok(Array.isArray(schema.enum) && schema.enum.length > 0);
      }
    }
    assert.equal(ANTHROPIC_TOOLS.length, COPILOT_TOOLS.length);
    assert.equal(OPENAI_TOOLS.length, COPILOT_TOOLS.length);
  });
});

describe("Claude request", () => {
  const req = anthropicRequest("claude-sonnet-5-5", convo, ctx);

  it("caches the static prompt and sends live state separately", () => {
    assert.equal(req.system.length, 2);
    assert.deepEqual(req.system[0]!.cache_control, { type: "ephemeral" });
    assert.ok(!("cache_control" in req.system[1]!));
    assert.match(req.system[1]!.text, /Clip: strike \(2\.00 s, 24 fps, plays once\); playhead 0\.250 s = frame 6/);
    assert.match(req.system[1]!.text, /- squash \(Squash & stretch\): No squash on impact/);
    assert.deepEqual(req.tool_choice, { type: "auto" });
  });

  it("alternates roles and pairs every tool_use with a tool_result", () => {
    const roles = req.messages.map((m) => m.role);
    assert.deepEqual(roles, ["user", "assistant", "user", "assistant", "user"]);
    const toolUse = req.messages[1]!.content.find((b) => b.type === "tool_use");
    assert.deepEqual(toolUse, { type: "tool_use", id: "toolu_1", name: "set_key", input: { bones: ["head"], r: 10 } });
    assert.deepEqual(req.messages[2]!.content, [{ type: "tool_result", tool_use_id: "toolu_1", content: "Keyed head at frame 6" }]);
  });

  it("puts tool results before new text when they share a user message", () => {
    const r = anthropicRequest("m", [...convo.slice(0, 3), { role: "user", text: "and the hips" }], ctx);
    const last = r.messages[r.messages.length - 1]!;
    assert.equal(last.role, "user");
    assert.deepEqual(
      last.content.map((b) => b.type),
      ["tool_result", "text"],
    );
  });

  it("marks failures and answers calls that were never run", () => {
    const r = anthropicRequest(
      "m",
      [
        { role: "user", text: "go" },
        {
          role: "assistant",
          text: "",
          calls: [
            { id: "a", tool: "undo", args: {} },
            { id: "b", tool: "redo", args: {} },
          ],
        },
        { role: "tool", results: [{ id: "a", ok: false, message: "Nothing to undo" }] },
        { role: "user", text: "ok" },
      ],
      ctx,
    );
    const results = r.messages[2]!.content.filter((b) => b.type === "tool_result");
    assert.deepEqual(
      results.map((b) => [b.type === "tool_result" && b.tool_use_id, b.type === "tool_result" && b.is_error]),
      [
        ["a", true],
        ["b", true],
      ],
    );
    assert.equal(r.messages[1]!.content[0]!.type, "tool_use", "no empty text block before tool calls");
  });
});

describe("transcript upkeep", () => {
  it("trims to a user turn so no tool result is orphaned", () => {
    const long: Turn[] = Array.from({ length: 10 }, () => convo).flat();
    const t = trimTranscript(long, 7);
    assert.equal(t[0]!.role, "user");
    assert.ok(t.length <= 7);
    for (let i = 0; i < t.length; i++) if (t[i]!.role === "tool") assert.equal(t[i - 1]!.role, "assistant");
  });

  it("never drops the prompt of a long run", () => {
    const run: Turn[] = [{ role: "user", text: "do a lot" }];
    for (let i = 0; i < 15; i++) {
      run.push({ role: "assistant", text: "", calls: [{ id: `c${i}`, tool: "undo", args: {} }] }, { role: "tool", results: [{ id: `c${i}`, ok: true, message: "ok" }] });
    }
    const t = trimTranscript(run, 24);
    assert.equal(t.length, run.length);
    assert.equal(anthropicRequest("m", run, ctx).messages[0]!.role, "user");
  });

  it("closes open calls", () => {
    const t = closeOpenCalls([{ role: "user", text: "x" }, { role: "assistant", text: "", calls: [{ id: "z", tool: "save", args: {} }] }], "Stopped");
    assert.deepEqual(t[2], { role: "tool", results: [{ id: "z", ok: false, message: "Stopped" }] });
  });
});

describe("Claude response", () => {
  it("reads text and tool calls", () => {
    const step = parseAnthropic({
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Meshing first." },
        { type: "tool_use", id: "toolu_9", name: "configure_mesh_and_weights", input: { part: "body", density: "high" } },
      ],
    });
    assert.equal(step.text, "Meshing first.");
    assert.deepEqual(step.calls, [{ id: "toolu_9", tool: "configure_mesh_and_weights", args: { part: "body", density: "high" } }]);
    assert.equal(step.done, false);
  });

  it("finishes on end_turn", () => {
    const step = parseAnthropic({ stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] });
    assert.deepEqual(step, { text: "Done.", calls: [], done: true });
    assert.deepEqual(parseAnthropic(null), { text: "", calls: [], done: true });
  });
});

describe("OpenAI-compatible", () => {
  it("builds function-calling messages", () => {
    const req = openAiRequest("gpt", convo, ctx);
    assert.equal(req.messages[0]!.role, "system");
    assert.match(String(req.messages[0]!.content), /Current studio state/);
    const assistant = req.messages[2] as { tool_calls: { id: string; function: { name: string; arguments: string } }[] };
    assert.equal(assistant.tool_calls[0]!.function.name, "set_key");
    assert.deepEqual(JSON.parse(assistant.tool_calls[0]!.function.arguments), { bones: ["head"], r: 10 });
    assert.deepEqual(req.messages[3], { role: "tool", tool_call_id: "toolu_1", content: "Keyed head at frame 6" });
  });

  it("survives malformed arguments", () => {
    const step = parseOpenAi({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", function: { name: "undo", arguments: "{oops" } }] } }] });
    assert.deepEqual(step.calls, [{ id: "c1", tool: "undo", args: { __invalid: "{oops" } }]);
  });
});

describe("errors", () => {
  it("explains the fix", () => {
    assert.match(explainProviderError(404, "not found", "claude-x", "Claude"), /KINETIC_CLAUDE_MODEL/);
    assert.match(explainProviderError(401, "bad key", "m", "Claude"), /rejected the API key/);
    assert.match(explainProviderError(529, "overloaded", "m", "Claude"), /overloaded/);
  });
});
