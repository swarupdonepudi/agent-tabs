import * as path from "path";

export interface Folder {
  name: string;
  path: string;
}

/**
 * Where a new tab opens. The setting may be a workspace folder's name or an
 * absolute path; empty means the first workspace folder.
 */
export function resolveFolder(setting: string, folders: Folder[], fallback: string): string {
  const wanted = setting.trim();
  if (wanted) {
    const byName = folders.find((f) => f.name === wanted);
    if (byName) return byName.path;
    if (path.isAbsolute(wanted)) return wanted;
  }
  return folders[0]?.path ?? fallback;
}
