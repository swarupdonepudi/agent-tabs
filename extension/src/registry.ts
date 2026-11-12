import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * What the agent-side hook last wrote for a tab:
 * - sessionId set: the conversation running in that tab
 * - sessionId null: the person exited the agent; the tab is a plain shell
 */
export interface SessionInfo {
  sessionId: string | null;
  cwd?: string;
  updatedAt?: string;
}

const SAFE_ID = /^[A-Za-z0-9-]+$/;

export function sessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.AGENT_TABS_HOME || path.join(os.homedir(), ".agent-tabs");
  return path.join(home, "sessions");
}

function fileFor(tabId: string, env?: NodeJS.ProcessEnv): string | undefined {
  if (!SAFE_ID.test(tabId)) return undefined;
  return path.join(sessionsDir(env), `${tabId}.json`);
}

/** The tab's session, or undefined if the hook never wrote one. */
export function readSession(tabId: string, env?: NodeJS.ProcessEnv): SessionInfo | undefined {
  const file = fileFor(tabId, env);
  if (!file) return undefined;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const sid = data.sessionId;
    if (sid !== null && (typeof sid !== "string" || !SAFE_ID.test(sid))) return undefined;
    return {
      sessionId: sid as string | null,
      cwd: typeof data.cwd === "string" ? data.cwd : undefined,
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
    };
  } catch {
    return undefined;
  }
}

export function deleteSession(tabId: string, env?: NodeJS.ProcessEnv): void {
  const file = fileFor(tabId, env);
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch {
    // already gone
  }
}
