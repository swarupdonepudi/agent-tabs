/**
 * An agent adapter tells Agent Tabs how to start and resume one terminal
 * coding agent. Adding an agent means adding one adapter (see claude.ts) and
 * a hook or plugin that writes the tab's session file.
 */
export interface AgentAdapter {
  /** Stable id, stored with every tab, e.g. "claude". */
  id: string;
  /** Human name, e.g. "Claude Code". */
  displayName: string;
  /** The executable's name, e.g. "claude": how a shell command line that starts the agent is recognised. */
  executable: string;
  /** Command line that starts a new conversation. */
  startCommand(extraArgs: string[]): string;
  /** Command line that reopens one saved conversation. */
  resumeCommand(sessionId: string, extraArgs: string[]): string;
  /** Command line that lets the person pick a past conversation. */
  pickerCommand(extraArgs: string[]): string;
  /** One-line install instructions for the agent-side half, shown when it seems missing. */
  companionInstall: string;
}
