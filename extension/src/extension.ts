import { randomUUID } from "crypto";
import * as os from "os";
import * as vscode from "vscode";
import { getAdapter, type AgentAdapter } from "./agents";
import { resolveFolder, wantedFolder } from "./folders";
import { deleteSession, readSession } from "./registry";
import { planRestore } from "./restore";
import { TabStore } from "./store";

/** Every tab Agent Tabs opens carries this variable; the agent-side hook reads it. */
const ENV_KEY = "AGENT_TABS_ID";
/** Wait this long for shell integration before typing the command directly. */
const SHELL_READY_TIMEOUT_MS = 4000;
/** If no session file shows up this long after a start, the companion is probably missing. */
const COMPANION_CHECK_MS = 30000;
const COMPANION_SEEN_KEY = "agentTabs.companionSeen";

export function activate(context: vscode.ExtensionContext): void {
  const store = new TabStore(context.workspaceState);
  const tracked = new Map<vscode.Terminal, string>();
  const log = vscode.window.createOutputChannel("Agent Tabs", { log: true });
  context.subscriptions.push(log);

  const settings = () => {
    const c = vscode.workspace.getConfiguration("agentTabs");
    return {
      agent: c.get<string>("defaultAgent", "claude"),
      folder: wantedFolder(c.get<string>("defaultFolder", ""), process.env),
      extraArgs: c.get<string[]>("extraArgs", []).filter((a) => typeof a === "string"),
      restoreOnStartup: c.get<boolean>("restoreOnStartup", true),
    };
  };

  const workspaceFolders = () =>
    (vscode.workspace.workspaceFolders ?? []).map((f) => ({ name: f.name, path: f.uri.fsPath }));

  const tabIdOf = (t: vscode.Terminal): string | undefined => {
    const fromMap = tracked.get(t);
    if (fromMap) return fromMap;
    const opts = t.creationOptions as vscode.TerminalOptions;
    const id = opts?.env?.[ENV_KEY];
    return typeof id === "string" ? id : undefined;
  };

  const openTerminal = (id: string, cwd: string, command: string | undefined): vscode.Terminal => {
    const term = vscode.window.createTerminal({
      cwd,
      env: { [ENV_KEY]: id },
      iconPath: new vscode.ThemeIcon("sparkle"),
    });
    tracked.set(term, id);
    if (command) runWhenReady(term, command);
    return term;
  };

  const adapterFor = (id: string): AgentAdapter | undefined => {
    const adapter = getAdapter(id);
    if (!adapter) log.warn(`Unknown agent "${id}"; skipping.`);
    return adapter;
  };

  const newTab = async (mode: "start" | "picker") => {
    const cfg = settings();
    const adapter = adapterFor(cfg.agent);
    if (!adapter) {
      void vscode.window.showErrorMessage(`Agent Tabs: unknown agent "${cfg.agent}".`);
      return;
    }
    const cwd = resolveFolder(cfg.folder, workspaceFolders(), os.homedir());
    const id = randomUUID();
    await store.add({ id, agent: adapter.id, cwd, createdAt: new Date().toISOString() });
    const command =
      mode === "start" ? adapter.startCommand(cfg.extraArgs) : adapter.pickerCommand(cfg.extraArgs);
    const term = openTerminal(id, cwd, command);
    term.show();
    log.info(`Opened tab ${id} in ${cwd}: ${command}`);
    checkCompanion(id, adapter, term);
  };

  const restore = async () => {
    const saved = store.list();
    if (saved.length === 0) return;

    // Terminals VS Code kept alive itself (a window reload) are adopted, not duplicated.
    const alive = new Set<string>();
    for (const t of vscode.window.terminals) {
      const id = tabIdOf(t);
      if (id && store.has(id)) {
        tracked.set(t, id);
        alive.add(id);
      }
    }

    const extraArgs = settings().extraArgs;
    const steps = planRestore(
      saved.filter((t) => !alive.has(t.id)),
      (id) => readSession(id),
    );
    let first: vscode.Terminal | undefined;
    for (const step of steps) {
      const adapter = adapterFor(step.tab.agent);
      if (!adapter) continue;
      const command =
        step.kind === "resume"
          ? adapter.resumeCommand(step.sessionId, extraArgs)
          : step.kind === "picker"
            ? adapter.pickerCommand(extraArgs)
            : undefined;
      const term = openTerminal(step.tab.id, step.cwd, command);
      first ??= term;
      log.info(`Restored tab ${step.tab.id} (${step.kind}) in ${step.cwd}`);
    }
    first?.show(true);
  };

  const checkCompanion = (id: string, adapter: AgentAdapter, term: vscode.Terminal) => {
    if (context.globalState.get<boolean>(COMPANION_SEEN_KEY)) return;
    const timer = setTimeout(async () => {
      if (readSession(id)) {
        await context.globalState.update(COMPANION_SEEN_KEY, true);
        return;
      }
      if (term.exitStatus) return;
      const copy = "Copy install command";
      const choice = await vscode.window.showWarningMessage(
        `Agent Tabs can't see which ${adapter.displayName} conversation runs in this tab, so it can't bring it back after a restart. Install the companion plugin, then start a new tab.`,
        copy,
      );
      if (choice === copy) {
        await vscode.env.clipboard.writeText(adapter.companionInstall);
        void vscode.window.showInformationMessage("Copied. Paste it into a terminal and press Enter.");
      }
    }, COMPANION_CHECK_MS);
    context.subscriptions.push({ dispose: () => clearTimeout(timer) });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("agentTabs.newTab", () => newTab("start")),
    vscode.commands.registerCommand("agentTabs.resumeTab", () => newTab("picker")),
    vscode.commands.registerCommand("agentTabs.restore", restore),
    vscode.commands.registerCommand("agentTabs.forgetAll", async () => {
      for (const t of store.list()) deleteSession(t.id);
      await store.clear();
      void vscode.window.showInformationMessage("Agent Tabs: this workspace has no saved tabs now.");
    }),
    vscode.window.onDidCloseTerminal(async (t) => {
      const id = tabIdOf(t);
      tracked.delete(t);
      if (!id) return;
      // Forget a tab only when the person closed it or its shell exited.
      // Quitting VS Code (Shutdown) or an unknown reason keeps it for the next start.
      const reason = t.exitStatus?.reason;
      if (reason !== vscode.TerminalExitReason.User && reason !== vscode.TerminalExitReason.Process) return;
      if (await store.remove(id)) {
        deleteSession(id);
        log.info(`Forgot tab ${id} (closed)`);
      }
    }),
  );

  if (settings().restoreOnStartup) {
    void restore().catch((err) => log.error(`Restore failed: ${String(err)}`));
  }
}

export function deactivate(): void {
  // Nothing to do: tabs are already saved, and quitting must keep them.
}

/** Run a command once the shell is ready, through shell integration when available. */
function runWhenReady(term: vscode.Terminal, command: string): void {
  if (term.shellIntegration) {
    term.shellIntegration.executeCommand(command);
    return;
  }
  let done = false;
  const finish = (run: () => void) => {
    if (done) return;
    done = true;
    sub.dispose();
    clearTimeout(timer);
    run();
  };
  const sub = vscode.window.onDidChangeTerminalShellIntegration((e) => {
    if (e.terminal === term) finish(() => e.shellIntegration.executeCommand(command));
  });
  const timer = setTimeout(() => finish(() => term.sendText(command, true)), SHELL_READY_TIMEOUT_MS);
}
