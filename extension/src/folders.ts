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

/** One row of the "New agent tab in folder" picker. */
export interface FolderChoice {
  name: string;
  path: string;
  /** Where the row comes from: the workspace (or the default folder outside it), or an earlier pick. */
  group: "workspace" | "recent";
  isDefault: boolean;
}

/** Folders kept for the picker's "Recent" group. */
export const MAX_RECENTS = 5;

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

/**
 * The picker's rows, in order: the default folder when it's outside the
 * workspace, every workspace folder, then recent picks from outside the
 * workspace. Also returns which row starts selected: the last folder picked
 * here, otherwise the default.
 */
export function folderChoices(
  workspaceFolders: Folder[],
  defaultPath: string,
  recents: string[],
  lastPicked?: string,
): { choices: FolderChoice[]; selected: number } {
  const choices: FolderChoice[] = [];
  const has = (p: string) => choices.some((c) => samePath(c.path, p));
  if (!workspaceFolders.some((f) => samePath(f.path, defaultPath))) {
    choices.push({ name: path.basename(defaultPath) || defaultPath, path: defaultPath, group: "workspace", isDefault: true });
  }
  for (const f of workspaceFolders) {
    if (has(f.path)) continue;
    choices.push({ name: f.name, path: f.path, group: "workspace", isDefault: samePath(f.path, defaultPath) });
  }
  for (const r of recents) {
    if (has(r)) continue;
    choices.push({ name: path.basename(r) || r, path: r, group: "recent", isDefault: false });
  }
  const last = lastPicked ? choices.findIndex((c) => samePath(c.path, lastPicked)) : -1;
  const fallback = choices.findIndex((c) => c.isDefault);
  return { choices, selected: last >= 0 ? last : Math.max(fallback, 0) };
}

/** Recent picks after choosing `picked`: only folders outside the workspace, newest first, at most MAX_RECENTS. */
export function rememberRecent(recents: string[], picked: string, workspaceFolders: Folder[]): string[] {
  if (workspaceFolders.some((f) => samePath(f.path, picked))) return recents;
  return [picked, ...recents.filter((r) => !samePath(r, picked))].slice(0, MAX_RECENTS);
}

/**
 * Theme colours that mark a tab running outside the default folder. Yellow and
 * red are left out: VS Code uses them for warnings and errors.
 */
export const FOLDER_COLORS = ["terminal.ansiCyan", "terminal.ansiMagenta", "terminal.ansiGreen", "terminal.ansiBlue"] as const;

/** The tab colour for a folder: none for the default folder, otherwise one picked by the folder's path, so a folder keeps its colour. */
export function colorFor(folderPath: string, defaultPath: string): string | undefined {
  if (samePath(folderPath, defaultPath)) return undefined;
  let hash = 0x811c9dc5;
  for (const ch of path.resolve(folderPath)) {
    hash ^= ch.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return FOLDER_COLORS[hash % FOLDER_COLORS.length];
}

/** A path for display, with the home folder shown as `~`. */
export function tildify(p: string, home: string): string {
  if (p === home) return "~";
  return p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p;
}
