# Agent Tabs

**Your terminal coding agents survive a VS Code restart.** Run five Claude Code sessions in VS Code's terminal, quit, reopen, and all five tabs are back, each in its own conversation. It works like the agent chats in Cursor, but your agents stay in the terminal.

<!-- demo.gif: quit, reopen, every agent tab comes back -->

## Install

1. **The VS Code extension:** search for "Agent Tabs" in the Extensions view, or download the `.vsix` from [Releases](https://github.com/swarupdonepudi/agent-tabs/releases) and run `code --install-extension agent-tabs-*.vsix`. It also works in Cursor, Windsurf and VSCodium (Open VSX).
2. **The Claude Code plugin** (it tells the extension which conversation runs in which tab):

   ```sh
   claude plugin marketplace add swarupdonepudi/agent-tabs
   claude plugin install agent-tabs@agent-tabs
   ```

3. Recommended: turn off VS Code's own terminal restore, so you don't get a second, dead copy of each tab:

   ```json
   "terminal.integrated.enablePersistentSessions": false
   ```

## Use

| Keys (terminal focused) | What happens |
|---|---|
| ⌘T / Ctrl+T | New tab running your agent |
| ⌘⇧T / Ctrl+Shift+T | New tab with the agent's picker of past conversations |

Close a tab, and it's forgotten. Quit VS Code (or let it crash), and every open tab comes back the next time you open the workspace.

## How it works

A coding agent's conversation isn't the process. It's saved on disk, and `claude --resume <id>` brings it back with its full history. So nothing has to stay running. VS Code only has to remember which tab held which conversation.

1. Every tab Agent Tabs opens gets an `AGENT_TABS_ID` in its environment.
2. Claude Code runs the plugin's `SessionStart` hook whenever a session starts, resumes or is `/clear`ed. The hook writes the tab's current session ID to `~/.agent-tabs/sessions/<AGENT_TABS_ID>.json`.
3. When the workspace opens, the extension rebuilds each saved tab in order and runs `claude --resume <id>` in the folder the conversation started in.

Because the agent reports its own session, this stays right when you `/clear`, `/resume` another chat, or type `claude` yourself inside a tab. Outside Agent Tabs (iTerm, other terminals) the hook does nothing.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `agentTabs.defaultAgent` | `claude` | The agent a new tab starts |
| `agentTabs.defaultFolder` | first workspace folder | A workspace folder's name or an absolute path |
| `agentTabs.extraArgs` | `[]` | Added to every start and resume, e.g. `["--chrome"]` |
| `agentTabs.restoreOnStartup` | `true` | Rebuild saved tabs when the workspace opens |

Commands: **Agent Tabs: Restore Saved Tabs** and **Agent Tabs: Forget All Saved Tabs in This Workspace**.

## Limits

- A reply the agent was in the middle of writing when you quit is lost. The conversation reopens at its last saved point; type "continue".
- Tabs come back in the order they were opened, not in an order you dragged them into.
- macOS and Linux. Windows needs a PowerShell version of the hook; contributions welcome.
- Only tabs opened through Agent Tabs (⌘T, ⌘⇧T) are tracked.

## Add your agent

Agent Tabs is agent-neutral. An agent needs two things:

1. An adapter in `extension/src/agents/` that builds its start, resume and picker commands. See `claude.ts`; it's 15 lines.
2. Something on the agent's side that writes `{"sessionId": "...", "cwd": "..."}` to `~/.agent-tabs/sessions/$AGENT_TABS_ID.json` when a session starts. For Claude Code that's the hook in `claude-plugin/`.

Codex and Gemini CLI adapters are open issues.

## Develop

```sh
cd extension
npm install
npm run check      # typecheck, tests, build
npm run package    # builds agent-tabs-<version>.vsix
```

## License

MIT
