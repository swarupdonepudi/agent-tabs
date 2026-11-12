import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { claude } from "../src/agents/claude";
import { resolveFolder } from "../src/folders";
import { deleteSession, readSession, sessionsDir } from "../src/registry";
import { planRestore } from "../src/restore";
import { commandLine, quote } from "../src/shell";
import { TabStore, type KeyValue, type TabRecord } from "../src/store";

class Memory implements KeyValue {
  data = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.data.set(key, structuredClone(value));
  }
}

const tab = (id: string, cwd = "/repo"): TabRecord => ({ id, agent: "claude", cwd, createdAt: "t" });

test("store keeps tabs in the order they were opened", async () => {
  const store = new TabStore(new Memory());
  await store.add(tab("a"));
  await store.add(tab("b"));
  await store.add(tab("c"));
  assert.deepEqual(store.list().map((t) => t.id), ["a", "b", "c"]);
  assert.equal(await store.remove("b"), true);
  assert.equal(await store.remove("b"), false);
  assert.deepEqual(store.list().map((t) => t.id), ["a", "c"]);
  await store.clear();
  assert.deepEqual(store.list(), []);
});

test("store ignores corrupt state", () => {
  const mem = new Memory();
  mem.data.set("agentTabs.tabs.v1", [{ id: 1 }, null, tab("ok")]);
  assert.deepEqual(new TabStore(mem).list().map((t) => t.id), ["ok"]);
});

test("quote leaves simple words alone and wraps the rest", () => {
  assert.equal(quote("--chrome"), "--chrome");
  assert.equal(quote("a b"), "'a b'");
  assert.equal(quote("it's"), "'it'\\''s'");
  assert.equal(commandLine(["claude", "--resume", "abc-1"]), "claude --resume abc-1");
});

test("claude adapter builds start, resume and picker commands", () => {
  assert.equal(claude.startCommand(["--chrome"]), "claude --chrome");
  assert.equal(claude.resumeCommand("1b2c-3d", ["--chrome"]), "claude --resume 1b2c-3d --chrome");
  assert.equal(claude.pickerCommand([]), "claude --resume");
});

test("resolveFolder picks by name, then absolute path, then first folder", () => {
  const folders = [
    { name: "projects", path: "/p" },
    { name: "api", path: "/api" },
  ];
  assert.equal(resolveFolder("api", folders, "/home"), "/api");
  assert.equal(resolveFolder("/abs/dir", folders, "/home"), "/abs/dir");
  assert.equal(resolveFolder("", folders, "/home"), "/p");
  assert.equal(resolveFolder("missing", folders, "/home"), "/p");
  assert.equal(resolveFolder("", [], "/home"), "/home");
});

test("planRestore resumes, opens a shell, or falls back to the picker", () => {
  const sessions: Record<string, ReturnType<typeof readSession>> = {
    a: { sessionId: "s-1", cwd: "/sub" },
    b: { sessionId: null },
    c: undefined,
    d: { sessionId: "s-4", cwd: "/gone" },
  };
  const steps = planRestore(
    [tab("a"), tab("b"), tab("c"), tab("d")],
    (id) => sessions[id],
    (dir) => dir !== "/gone",
  );
  assert.deepEqual(
    steps.map((s) => [s.tab.id, s.kind, s.cwd, s.kind === "resume" ? s.sessionId : null]),
    [
      ["a", "resume", "/sub", "s-1"],
      ["b", "shell", "/repo", null],
      ["c", "picker", "/repo", null],
      ["d", "resume", "/repo", "s-4"],
    ],
  );
});

test("registry reads what the hook writes and rejects unsafe ids", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tabs-"));
  const env = { AGENT_TABS_HOME: home };
  try {
    fs.mkdirSync(sessionsDir(env), { recursive: true });
    const write = (id: string, body: string) => fs.writeFileSync(path.join(sessionsDir(env), `${id}.json`), body);
    write("t1", '{"tabId":"t1","agent":"claude","sessionId":"abc-1","cwd":"/x","updatedAt":"now"}');
    write("t2", '{"tabId":"t2","agent":"claude","sessionId":null,"cwd":"/x"}');
    write("t3", '{"sessionId":"../../etc"}');
    write("t4", "not json");
    assert.deepEqual(readSession("t1", env), { sessionId: "abc-1", cwd: "/x", updatedAt: "now" });
    assert.equal(readSession("t2", env)?.sessionId, null);
    assert.equal(readSession("t3", env), undefined);
    assert.equal(readSession("t4", env), undefined);
    assert.equal(readSession("../t1", env), undefined);
    assert.equal(readSession("nope", env), undefined);
    deleteSession("t1", env);
    assert.equal(readSession("t1", env), undefined);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
