import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { claude } from "../src/agents/claude";
import { colorFor, folderChoices, FOLDER_COLORS, MAX_RECENTS, rememberRecent, resolveFolder, tildify, wantedFolder } from "../src/folders";
import { deleteSession, readSession, sessionsDir } from "../src/registry";
import { escapePath, filePaste, isAgentCommandLine } from "../src/paste";
import { planRestore } from "../src/restore";
import { claudeTitleState, clearSpinner, IDLE_CLEAR_MS, recordedState, shouldClear } from "../src/status";
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

test("claudeTitleState reads Claude's own title glyphs", () => {
  assert.equal(claudeTitleState("$(loading~spin) ✳ kfd"), "idle");
  assert.equal(claudeTitleState("✳ customize vscode"), "idle");
  assert.equal(claudeTitleState("◐ build-prompt-first-onboarding"), "busy");
  assert.equal(claudeTitleState("$(loading~spin) ◑ engage"), "busy");
  assert.equal(claudeTitleState("zsh"), "unknown");
  assert.equal(claudeTitleState(""), "unknown");
});

test("shouldClear clears only the working spinner, and only after Claude has looked idle for a while", () => {
  assert.equal(shouldClear("3", 1000, 1000 + IDLE_CLEAR_MS), true);
  assert.equal(shouldClear("3", 1000, 1000 + IDLE_CLEAR_MS - 1), false);
  assert.equal(shouldClear("3", undefined, 99999), false);
  for (const s of ["0", "2", "4", "bg", undefined]) assert.equal(shouldClear(s, 0, 99999), false);
});

test("clearSpinner writes the clear signal and records done, only from the working state", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tabs-clear-"));
  const env = { AGENT_TABS_HOME: home };
  const dir = path.join(home, "status");
  fs.mkdirSync(dir);
  const tty = path.join(home, "tty");
  try {
    fs.writeFileSync(tty, "");
    fs.writeFileSync(path.join(dir, "s1"), "3");
    assert.equal(clearSpinner("s1", env, tty), true);
    assert.equal(fs.readFileSync(tty, "latin1"), "\x1b]9;4;0\x07");
    assert.equal(recordedState("s1", env), "0");
    assert.equal(clearSpinner("s1", env, tty), false);
    for (const s of ["4", "bg", "2"]) {
      fs.writeFileSync(path.join(dir, "s2"), s);
      assert.equal(clearSpinner("s2", env, tty), false);
      assert.equal(recordedState("s2", env), s);
    }
    fs.writeFileSync(path.join(dir, "s3"), "3");
    fs.writeFileSync(path.join(dir, "s3.tty"), "/etc/passwd");
    assert.equal(clearSpinner("s3", env), false);
    assert.equal(clearSpinner("../x", env, tty), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
