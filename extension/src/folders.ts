import * as path from "path";

export interface Folder {
  name: string;
  path: string;
}

/** Overrides `agentTabs.defaultFolder` on one machine, without touching shared settings. */
export const FOLDER_ENV = "AGENT_TABS_FOLDER";

/** The folder wanted: the environment variable when set, otherwise the setting. */
export function wantedFolder(setting: string, env: NodeJS.ProcessEnv): string {
  return env[FOLDER_ENV]?.trim() || setting.trim();
}

/**
 * Where a new tab opens. `wanted` may be a workspace folder's name, an
 * absolute path or a path starting with `~/`; empty means the first workspace folder.
 */
export function resolveFolder(wanted: string, folders: Folder[], fallback: string, home = fallback): string {
  if (wanted) {
    const byName = folders.find((f) => f.name === wanted);
    if (byName) return byName.path;
    if (wanted === "~") return home;
    if (wanted.startsWith("~/")) return path.join(home, wanted.slice(2));
    if (path.isAbsolute(wanted)) return wanted;
  }
  return folders[0]?.path ?? fallback;
}
