import * as fs from "fs";
import type { SessionInfo } from "./registry";
import type { TabRecord } from "./store";

export type RestoreStep =
  | { tab: TabRecord; kind: "resume"; sessionId: string; cwd: string }
  | { tab: TabRecord; kind: "shell"; cwd: string }
  | { tab: TabRecord; kind: "picker"; cwd: string };

/**
 * Decide how to rebuild each saved tab:
 * - a recorded conversation is resumed, in the folder it was started in
 * - an agent the person exited leaves a plain shell
 * - no record at all (the agent-side hook is missing) opens the picker,
 *   so nothing is lost
 */
export function planRestore(
  tabs: TabRecord[],
  read: (tabId: string) => SessionInfo | undefined,
  dirExists: (dir: string) => boolean = defaultDirExists,
): RestoreStep[] {
  return tabs.map((tab) => {
    const info = read(tab.id);
    const cwd = info?.cwd && dirExists(info.cwd) ? info.cwd : tab.cwd;
    if (!info) return { tab, kind: "picker", cwd };
    if (info.sessionId === null) return { tab, kind: "shell", cwd };
    return { tab, kind: "resume", sessionId: info.sessionId, cwd };
  });
}

function defaultDirExists(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
