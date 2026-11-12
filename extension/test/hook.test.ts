import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { readSession } from "../src/registry";

const HOOK = path.resolve(__dirname, "../../claude-plugin/hooks/register.sh");

function run(event: string, input: object, env: Record<string, string>, cwd: string) {
  execFileSync("sh", [HOOK, event], {
    input: JSON.stringify(input),
    env: { PATH: process.env.PATH ?? "", ...env },
    cwd,
  });
}

test("hook records the session on start and clears it only on a deliberate exit", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tabs-hook-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tabs-cwd-"));
  const env = { AGENT_TABS_HOME: home, AGENT_TABS_ID: "tab-1" };
  try {
    run("start", { session_id: "11111111-aaaa", source: "startup" }, env, cwd);
    assert.equal(readSession("tab-1", env)?.sessionId, "11111111-aaaa");
    assert.equal(fs.realpathSync(readSession("tab-1", env)!.cwd!), fs.realpathSync(cwd));

    run("start", { session_id: "22222222-bbbb", source: "clear" }, env, cwd);
    assert.equal(readSession("tab-1", env)?.sessionId, "22222222-bbbb");

    run("end", { session_id: "22222222-bbbb", reason: "other" }, env, cwd);
    assert.equal(readSession("tab-1", env)?.sessionId, "22222222-bbbb");

    run("end", { session_id: "22222222-bbbb", reason: "prompt_input_exit" }, env, cwd);
    assert.equal(readSession("tab-1", env)?.sessionId, null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("hook does nothing outside Agent Tabs or with unsafe input", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tabs-hook-"));
  try {
    run("start", { session_id: "x-1" }, { AGENT_TABS_HOME: home }, os.tmpdir());
    run("start", { session_id: "x-1" }, { AGENT_TABS_HOME: home, AGENT_TABS_ID: "../evil" }, os.tmpdir());
    run("start", { session_id: "$(touch pwned)" }, { AGENT_TABS_HOME: home, AGENT_TABS_ID: "t" }, os.tmpdir());
    const dir = path.join(home, "sessions");
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    assert.deepEqual(files, []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

const STATUS = path.resolve(__dirname, "../../claude-plugin/hooks/status.sh");

/** Runs the status hook and returns the OSC 9;4 state it asked Claude to emit, or null for none. */
function status(event: string, input: object, env: Record<string, string>): string | null {
  const out = execFileSync("sh", [STATUS, event], {
    input: JSON.stringify(input),
    env: { PATH: process.env.PATH ?? "", ...env },
  }).toString();
  if (out.trim() === "") return null;
  const reply = JSON.parse(out) as { terminalSequence: string; suppressOutput: boolean };
  assert.equal(reply.suppressOutput, true);
  const m = /^\u001b\]9;4;(\d)\u0007$/.exec(reply.terminalSequence);
  assert.ok(m, `unexpected sequence ${JSON.stringify(reply.terminalSequence)}`);
  return m[1];
}

test("status hook maps each event to the tab's state in VS Code", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tabs-status-"));
  const env = { AGENT_TABS_HOME: home, TERM_PROGRAM: "vscode" };
  const s = (event: string, extra: object = {}) =>
    status(event, { session_id: "sess-1", hook_event_name: event, ...extra }, env);
  try {
    assert.equal(s("SessionStart"), "0");
    assert.equal(s("UserPromptSubmit"), "3");
    assert.equal(s("PreToolUse", { tool_name: "Bash", tool_input: { command: 'echo "tool_name": "AskUserQuestion"' } }), "3");
    assert.equal(s("PostToolUse", { tool_name: "Bash" }), "3");
    assert.equal(s("PostToolUseFailure", { tool_name: "Bash" }), "3");
    assert.equal(s("PreToolUse", { tool_name: "AskUserQuestion" }), "4");
    assert.equal(s("PreToolUse", { tool_name: "ExitPlanMode" }), "4");
    assert.equal(s("PermissionRequest", { tool_name: "Bash" }), "4");
    assert.equal(s("Notification", { notification_type: "permission_prompt" }), "4");
    assert.equal(s("Notification", { notification_type: "elicitation_dialog" }), "4");
    assert.equal(s("Notification", { notification_type: "auth_success" }), null);
    assert.equal(s("Stop"), "0");
    assert.equal(s("StopFailure"), "2");
    assert.equal(s("SubagentStop"), null);
    assert.equal(s("SessionEnd"), "0");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the idle notice clears a stale spinner but never an open question", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tabs-status-"));
  const env = { AGENT_TABS_HOME: home, TERM_PROGRAM: "vscode" };
  const s = (event: string, extra: object = {}) =>
    status(event, { session_id: "sess-2", hook_event_name: event, ...extra }, env);
  const idle = { notification_type: "idle_prompt" };
  try {
    // Esc interrupts a turn without a Stop event: the spinner is left behind.
    s("UserPromptSubmit");
    assert.equal(s("Notification", idle), "0");
    // A question stays flagged while it waits.
    s("PreToolUse", { tool_name: "AskUserQuestion" });
    assert.equal(s("Notification", idle), null);
    // After a normal finish there is nothing to clear.
    s("Stop");
    assert.equal(s("Notification", idle), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("status hook stays silent outside VS Code", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tabs-status-"));
  try {
    for (const term of ["iTerm.app", "Apple_Terminal", ""]) {
      assert.equal(status("UserPromptSubmit", { session_id: "s" }, { AGENT_TABS_HOME: home, TERM_PROGRAM: term }), null);
    }
    assert.deepEqual(fs.readdirSync(home), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
