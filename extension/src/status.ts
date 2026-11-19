import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Keeping the tab's status icon honest.
 *
 * The plugin's status hook sets the working spinner on Claude's events and
 * clears it on Stop. An Esc fires no Stop, and Claude's 60-second "waiting
 * for input" notice is skipped while a dialog is on screen, so a spinner
 * could outlive its turn. Claude's own terminal title says what it is doing:
 * "◐"/"◑" alternate while it works, "✳" when it's idle. The extension reads
 * that title and clears a spinner Claude has been idle under for a while.
 */

export type ClaudeTitleState = "busy" | "idle" | "unknown";

const BUSY_GLYPHS = /[◐◑]/;
const IDLE_GLYPH = "✳";

/** What Claude's own title in a tab says about it; unknown when the title carries no Claude glyph. */
export function claudeTitleState(title: string): ClaudeTitleState {
  if (BUSY_GLYPHS.test(title)) return "busy";
  if (title.includes(IDLE_GLYPH)) return "idle";
  return "unknown";
}

/** How long Claude must look idle before a leftover spinner is cleared. */
export const IDLE_CLEAR_MS = 2000;

/**
 * Whether to clear the spinner: only the working state ("3"), never the alert,
 * the error or the background-agent spinner ("bg"), and only after Claude's
 * title has said idle for IDLE_CLEAR_MS.
 */
export function shouldClear(recorded: string | undefined, idleSince: number | undefined, now: number): boolean {
  return recorded === "3" && idleSince !== undefined && now - idleSince >= IDLE_CLEAR_MS;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const TTY = /^\/dev\/(ttys?\d+|pts\/\d+)$/;

export function statusDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.AGENT_TABS_HOME || path.join(os.homedir(), ".agent-tabs"), "status");
}

/** The state the status hook last recorded for a session, if any. */
export function recordedState(sessionId: string, env?: NodeJS.ProcessEnv): string | undefined {
  if (!SAFE_ID.test(sessionId)) return undefined;
  try {
    return fs.readFileSync(path.join(statusDir(env), sessionId), "utf8").trim();
  } catch {
    return undefined;
  }
}

/**
 * Clears a session's leftover spinner: writes the "no progress" signal to the
 * terminal the hook recorded and records the state as done. Does nothing unless
 * the recorded state is still "3" and the recorded terminal is a real tty.
 */
export function clearSpinner(sessionId: string, env?: NodeJS.ProcessEnv, ttyOverride?: string): boolean {
  if (!SAFE_ID.test(sessionId) || recordedState(sessionId, env) !== "3") return false;
  const dir = statusDir(env);
  let tty = ttyOverride;
  if (tty === undefined) {
    try {
      tty = fs.readFileSync(path.join(dir, `${sessionId}.tty`), "utf8").trim();
    } catch {
      return false;
    }
    if (!TTY.test(tty)) return false;
  }
  try {
    fs.appendFileSync(tty, "\x1b]9;4;0\x07");
    fs.writeFileSync(path.join(dir, sessionId), "0");
    return true;
  } catch {
    return false;
  }
}
