import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { claude } from "../src/agents/claude";
import { colorFor, folderChoices, FOLDER_COLORS, MAX_RECENTS, rememberRecent, resolveFolder, tildify, wantedFolder } from "../src/folders";
import { deleteSession, readSession, sessionsDir } from "../src/registry";
import { escapePath, filePaste, isAgentCommandLine } from "../src/paste";
import { planRestore, restoreLaunches } from "../src/restore";
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
  assert.equal(resolveFolder("~/code/app", folders, "/home"), "/home/code/app");
});

test("AGENT_TABS_FOLDER overrides the setting", () => {
  assert.equal(wantedFolder("planton-platform", {}), "planton-platform");
  assert.equal(wantedFolder("planton-platform", { AGENT_TABS_FOLDER: " stigmer " }), "stigmer");
  assert.equal(wantedFolder("planton-platform", { AGENT_TABS_FOLDER: "" }), "planton-platform");
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

const ws = [
  { name: "projects", path: "/scm/projects" },
  { name: "life", path: "/scm/life" },
  { name: "planton-platform", path: "/scm/planton-platform" },
];

test("folderChoices lists the workspace, then recent picks, and starts on the last pick or the default", () => {
  const r = folderChoices(ws, "/scm/planton-platform", ["/tmp/notes", "/scm/life"]);
  assert.deepEqual(r.choices.map((c) => [c.name, c.group, c.isDefault]), [
    ["projects", "workspace", false],
    ["life", "workspace", false],
    ["planton-platform", "workspace", true],
    ["notes", "recent", false],
  ]);
  assert.equal(r.selected, 2);
  assert.equal(folderChoices(ws, "/scm/planton-platform", [], "/scm/life").selected, 1);
  assert.equal(folderChoices(ws, "/scm/planton-platform", [], "/gone").selected, 2);
});

test("folderChoices puts a default folder from outside the workspace first", () => {
  const r = folderChoices(ws, "/elsewhere/api", []);
  assert.deepEqual(r.choices[0], { name: "api", path: "/elsewhere/api", group: "workspace", isDefault: true });
  assert.equal(r.selected, 0);
  assert.equal(r.choices.length, 4);
});

test("folderChoices with no workspace offers the default and recent picks", () => {
  const r = folderChoices([], "/home/me", ["/home/me/code"]);
  assert.deepEqual(r.choices.map((c) => c.path), ["/home/me", "/home/me/code"]);
});

test("rememberRecent keeps only folders outside the workspace, newest first", () => {
  assert.deepEqual(rememberRecent(["/a"], "/scm/life", ws), ["/a"]);
  assert.deepEqual(rememberRecent(["/a", "/b"], "/b", ws), ["/b", "/a"]);
  const next = rememberRecent(["/1", "/2", "/3", "/4", "/5"], "/6", ws);
  assert.equal(next.length, MAX_RECENTS);
  assert.equal(next[0], "/6");
});

test("colorFor leaves the default folder plain and gives each other folder a stable colour", () => {
  assert.equal(colorFor("/scm/planton-platform", "/scm/planton-platform"), undefined);
  assert.equal(colorFor("/scm/planton-platform/", "/scm/planton-platform"), undefined);
  const c = colorFor("/scm/life", "/scm/planton-platform");
  assert.ok(c && (FOLDER_COLORS as readonly string[]).includes(c));
  assert.equal(colorFor("/scm/life", "/scm/projects"), c);
});

test("tildify shows the home folder as ~", () => {
  assert.equal(tildify("/Users/me/scm/life", "/Users/me"), "~/scm/life");
  assert.equal(tildify("/Users/me", "/Users/me"), "~");
  assert.equal(tildify("/Users/meow", "/Users/me"), "/Users/meow");
});


test("restoreLaunches starts only the shown tab at once; the rest wait to be shown", () => {
  assert.deepEqual(restoreLaunches(["a", "b", "c"]), { now: ["a"], onShow: ["b", "c"] });
  assert.deepEqual(restoreLaunches(["a", "b", "c"], 2), { now: ["c"], onShow: ["a", "b"] });
  assert.deepEqual(restoreLaunches([]), { now: [], onShow: [] });
});

test("escapePath escapes what a shell needs, the way iTerm pastes files", () => {
  assert.equal(escapePath("/Users/me/Desktop/shot.png"), "/Users/me/Desktop/shot.png");
  assert.equal(escapePath("/a b/it's (1).png"), "/a\\ b/it\\'s\\ \\(1\\).png");
  assert.equal(escapePath("/x/$HOME&[y].png"), "/x/\\$HOME\\&\\[y\\].png");
});

test("filePaste brackets the paths for an agent and types them for a shell", () => {
  assert.equal(filePaste(["/a.png", "/b c.png"], true), "\x1b[200~/a.png /b\\ c.png\x1b[201~");
  assert.equal(filePaste(["/a.png", "/b c.png"], false), "/a.png /b\\ c.png");
});

test("isAgentCommandLine finds the agent after env assignments, bare or by path", () => {
  const ex = ["claude"];
  assert.equal(isAgentCommandLine("claude --resume abc --chrome", ex), true);
  assert.equal(isAgentCommandLine("  claude", ex), true);
  assert.equal(isAgentCommandLine("/Users/me/.local/bin/claude -p hi", ex), true);
  assert.equal(isAgentCommandLine("FOO=1 BAR=x claude", ex), true);
  assert.equal(isAgentCommandLine("echo claude", ex), false);
  assert.equal(isAgentCommandLine("claude-code-router", ex), false);
  assert.equal(isAgentCommandLine("", ex), false);
});
