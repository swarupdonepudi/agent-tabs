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
