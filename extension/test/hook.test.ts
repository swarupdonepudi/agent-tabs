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

test("hook leaves the tab alone for a headless claude -p started inside it", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tabs-hook-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tabs-cwd-"));
  const tab = { AGENT_TABS_HOME: home, AGENT_TABS_ID: "tab-1" };
  try {
    run("start", { session_id: "11111111-aaaa" }, { ...tab, AGENT_TABS_TTY: "/dev/ttys001" }, cwd);
    run("start", { session_id: "99999999-headless" }, { ...tab, AGENT_TABS_TTY: "" }, cwd);
    run("end", { session_id: "99999999-headless", reason: "prompt_input_exit" }, { ...tab, AGENT_TABS_TTY: "" }, cwd);
    assert.equal(readSession("tab-1", tab)?.sessionId, "11111111-aaaa");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

const STATUS = path.resolve(__dirname, "../../claude-plugin/hooks/status.sh");

/** A fake tab: runs the status hook against a file standing in for Claude's terminal. */
function fakeTab(sessionId: string, extraEnv: Record<string, string> = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tabs-status-"));
  const tty = path.join(home, "tty");
  fs.writeFileSync(tty, "");
  const env = { AGENT_TABS_HOME: home, TERM_PROGRAM: "vscode", AGENT_TABS_TTY: tty, ...extraEnv };
  /** Runs one event; returns the OSC 9;4 state it wrote, or null if it wrote nothing. */
  const send = (event: string, extra: object = {}): string | null => {
    const out = execFileSync("sh", [STATUS, event], {
      input: JSON.stringify({ session_id: sessionId, hook_event_name: event, ...extra }),
      env: { PATH: process.env.PATH ?? "", ...env },
    }).toString();
    assert.equal(out, "", "the hook must not answer Claude on stdout");
    const written = fs.existsSync(tty) ? fs.readFileSync(tty, "latin1") : "";
    fs.writeFileSync(tty, "");
    if (written === "") return null;
    const m = /^\u001b\]9;4;(\d)\u0007$/.exec(written);
    assert.ok(m, `unexpected bytes ${JSON.stringify(written)}`);
    return m[1];
  };
  return { home, send, done: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test("status hook maps each event to the tab's state in VS Code", () => {
  const { send, done } = fakeTab("sess-1");
  try {
    assert.equal(send("SessionStart"), "0");
    assert.equal(send("UserPromptSubmit"), "3");
    assert.equal(send("PreToolUse", { tool_name: "Bash", tool_input: { command: 'echo "tool_name": "AskUserQuestion"' } }), "3");
    assert.equal(send("PostToolUse", { tool_name: "Bash" }), "3");
    assert.equal(send("PostToolUseFailure", { tool_name: "Bash" }), "3");
    assert.equal(send("PreToolUse", { tool_name: "AskUserQuestion" }), "4");
    assert.equal(send("PreToolUse", { tool_name: "ExitPlanMode" }), "4");
    assert.equal(send("PermissionRequest", { tool_name: "Bash" }), "4");
    assert.equal(send("Notification", { notification_type: "permission_prompt" }), "4");
    assert.equal(send("Notification", { notification_type: "elicitation_dialog" }), "4");
    assert.equal(send("Notification", { notification_type: "auth_success" }), null);
    assert.equal(send("Stop"), "0");
    assert.equal(send("StopFailure"), "2");
    assert.equal(send("SessionEnd"), "0");
  } finally {
    done();
  }
});

test("a background agent keeps the tab spinning after the turn ends", () => {
  const { send, done } = fakeTab("sess-bg");
  try {
    send("UserPromptSubmit");
    assert.equal(send("SubagentStart", { agent_id: "agent-a" }), null);
    assert.equal(send("SubagentStart", { agent_id: "agent-b" }), null);
    assert.equal(send("Stop"), "3");
    // Waiting on agents is not a stale spinner.
    assert.equal(send("Notification", { notification_type: "idle_prompt" }), null);
    assert.equal(send("SubagentStop", { agent_id: "agent-a" }), null);
    assert.equal(send("SubagentStop", { agent_id: "agent-b" }), "0");
    // A foreground agent that finishes inside a turn changes nothing.
    send("UserPromptSubmit");
    send("SubagentStart", { agent_id: "agent-c" });
    assert.equal(send("SubagentStop", { agent_id: "agent-c" }), null);
    assert.equal(send("Stop"), "0");
  } finally {
    done();
  }
});

test("a resumed session forgets the agents of the process before it", () => {
  const { send, done } = fakeTab("sess-resume");
  try {
    send("UserPromptSubmit");
    send("SubagentStart", { agent_id: "agent-old" });
    send("SessionStart");
    send("UserPromptSubmit");
    assert.equal(send("Stop"), "0");
  } finally {
    done();
  }
});

test("the idle notice clears a stale spinner but never an open question", () => {
  const { send, done } = fakeTab("sess-2");
  const idle = { notification_type: "idle_prompt" };
  try {
    // Esc stops a turn without a Stop event: the spinner is left behind.
    send("UserPromptSubmit");
    assert.equal(send("Notification", idle), "0");
    send("PreToolUse", { tool_name: "AskUserQuestion" });
    assert.equal(send("Notification", idle), null);
    send("Stop");
    assert.equal(send("Notification", idle), null);
  } finally {
    done();
  }
});

test("status hook stays silent outside VS Code and for headless runs", () => {
  for (const term of ["iTerm.app", "Apple_Terminal", ""]) {
    const { home, send, done } = fakeTab("s", { TERM_PROGRAM: term });
    try {
      assert.equal(send("UserPromptSubmit"), null);
      assert.deepEqual(fs.readdirSync(home), ["tty"]);
    } finally {
      done();
    }
  }
  const headless = fakeTab("s", { AGENT_TABS_TTY: "" });
  try {
    assert.equal(headless.send("UserPromptSubmit"), null);
  } finally {
    headless.done();
  }
});

test("status hook ignores unsafe session and agent ids", () => {
  const { home, send, done } = fakeTab("../evil");
  try {
    assert.equal(send("UserPromptSubmit"), null);
    assert.deepEqual(fs.readdirSync(home), ["tty"]);
  } finally {
    done();
  }
});
