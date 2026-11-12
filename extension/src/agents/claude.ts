import { commandLine } from "../shell";
import type { AgentAdapter } from "./types";

export const claude: AgentAdapter = {
  id: "claude",
  displayName: "Claude Code",
  startCommand: (extraArgs) => commandLine(["claude", ...extraArgs]),
  resumeCommand: (sessionId, extraArgs) => commandLine(["claude", "--resume", sessionId, ...extraArgs]),
  pickerCommand: (extraArgs) => commandLine(["claude", "--resume", ...extraArgs]),
  companionInstall:
    "claude plugin marketplace add swarupdonepudi/agent-tabs && claude plugin install agent-tabs@agent-tabs",
};
