/**
 * Pasting copied files into an agent tab.
 *
 * VS Code's terminal pastes the clipboard's text, and only falls back to a
 * copied file's path when there is no text, and then only the first file.
 * Finder puts copied files' bare names on the clipboard as text, so several
 * copied images arrive as names the agent can't find. Agent Tabs pastes every
 * copied file's full path instead, as iTerm does.
 */

/** Characters a shell (and Claude Code's paste reader) needs escaped in a path. */
const SPECIAL = /([ \t\\'"`$!&;|<>(){}[\]*?#^])/g;

/** One path, with shell-special characters escaped by a backslash, the way iTerm pastes files. */
export function escapePath(p: string): string {
  return p.replace(SPECIAL, "\\$1");
}

/**
 * The bytes to send for pasted files: every path, escaped, separated by spaces.
 * An agent reads pasted image paths as attachments only when they arrive as a
 * paste, so for an agent the text is wrapped in bracketed-paste markers. A
 * plain shell gets the paths as typed text.
 */
export function filePaste(paths: string[], bracketed: boolean): string {
  const text = paths.map(escapePath).join(" ");
  return bracketed ? `\x1b[200~${text}\x1b[201~` : text;
}

/**
 * Whether a shell command line starts one of the agents: the first word after
 * any `NAME=value` assignments is the agent's executable, bare or as a path.
 */
export function isAgentCommandLine(line: string, executables: string[]): boolean {
  const words = line.trim().split(/\s+/);
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  const first = words[i];
  if (!first) return false;
  const name = first.split("/").pop() ?? first;
  return executables.includes(name);
}

/**
 * macOS JavaScript for Automation that prints the clipboard's file paths as a
 * JSON array (empty when it holds no files). Run with `osascript -l JavaScript -e`.
 */
export const CLIPBOARD_FILES_JXA = `ObjC.import("AppKit");
const pb = $.NSPasteboard.generalPasteboard;
const opts = $.NSDictionary.dictionaryWithObjectForKey(true, $.NSPasteboardURLReadingFileURLsOnlyKey);
const urls = pb.readObjectsForClassesOptions($.NSArray.arrayWithObject($.NSURL), opts);
const out = [];
if (!urls.isNil()) for (let i = 0; i < urls.count; i++) out.push(urls.objectAtIndex(i).path.js);
JSON.stringify(out);`;
