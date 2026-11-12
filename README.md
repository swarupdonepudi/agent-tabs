# Agent Tabs

**Your terminal coding agents survive a VS Code restart, and every tab shows what its agent is doing.** Run five Claude Code sessions in VS Code's terminal and see at a glance which one is working, which one needs you, and which one is done. Quit, reopen, and all five tabs are back, each in its own conversation. It works like the agent chats in Cursor, but your agents stay in the terminal.

<!-- demo.gif: quit, reopen, every agent tab comes back -->

## Install

1. **The VS Code extension:** search for "Agent Tabs" in the Extensions view, or download the `.vsix` from [Releases](https://github.com/swarupdonepudi/agent-tabs/releases) and run `code --install-extension agent-tabs-*.vsix`. It also works in Cursor, Windsurf and VSCodium (Open VSX).
2. **The Claude Code plugin** (it tells the extension which conversation runs in which tab, and puts each agent's status on its tab):

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

## See what each agent is doing

Each tab running Claude Code shows an icon before its title:

| Tab | Means |
|---|---|
| spinning icon | Claude is working |
| alert icon | Claude needs you: a question, a plan to approve, or a permission |
| no icon | Done, your turn |
| error icon | The turn stopped on an error |

It works in any VS Code terminal running `claude`, not only tabs opened through Agent Tabs, and it shows on background tabs too, so you can tell which one to switch to.

How it works: the plugin's hooks answer Claude Code's events (prompt submitted, tool started or finished, question asked, permission requested, turn stopped) with an `OSC 9;4` progress signal, which Claude writes to its terminal. VS Code draws that signal in the tab title through the `${progress}` variable. The extension turns this on by setting two defaults:

```json
"terminal.integrated.tabs.allowAgentCliTitle": false,
"terminal.integrated.tabs.title": "${progress} ${sequence}"
```

The first one stops VS Code from showing only Claude's own title, so the icon can sit before it. The second shows the icon, then the title the running program sets: Claude's conversation name, or your shell's title.

If your shell sets a long title (oh-my-zsh shows `user@host:~/path`), plain shell tabs show it now. To keep them short, add this to `~/.zshrc` after oh-my-zsh loads:

```sh
[[ "$TERM_PROGRAM" == vscode ]] && ZSH_THEME_TERM_TITLE_IDLE="zsh"
```

If you turned on Claude Code's own terminal progress bar (`/config`), turn it off, so it doesn't overwrite the alert icon.

## How restore works

A coding agent's conversation isn't the process. It's saved on disk, and `claude --resume <id>` brings it back with its full history. So nothing has to stay running. VS Code only has to remember which tab held which conversation.

1. Every tab Agent Tabs opens gets an `AGENT_TABS_ID` in its environment.
2. Claude Code runs the plugin's `SessionStart` hook whenever a session starts, resumes or is `/clear`ed. The hook writes the tab's current session ID to `~/.agent-tabs/sessions/<AGENT_TABS_ID>.json`.
3. When the workspace opens, the extension rebuilds each saved tab in order and runs `claude --resume <id>` in the folder the conversation started in.

Because the agent reports its own session, this stays right when you `/clear`, `/resume` another chat, or type `claude` yourself inside a tab. Outside Agent Tabs (iTerm, other terminals) the hook does nothing.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `agentTabs.defaultAgent` | `claude` | The agent a new tab starts |
| `agentTabs.defaultFolder` | first workspace folder | A workspace folder's name, an absolute path or `~/…`. The `AGENT_TABS_FOLDER` environment variable overrides it on one machine |
| `agentTabs.extraArgs` | `[]` | Added to every start and resume, e.g. `["--chrome"]` |
| `agentTabs.restoreOnStartup` | `true` | Rebuild saved tabs when the workspace opens |

Commands: **Agent Tabs: Restore Saved Tabs** and **Agent Tabs: Forget All Saved Tabs in This Workspace**.

## Limits

- A reply the agent was in the middle of writing when you quit is lost. The conversation reopens at its last saved point; type "continue".
- Tabs come back in the order they were opened, not in an order you dragged them into.
- macOS and Linux. Windows needs a PowerShell version of the hook; contributions welcome.
- Only tabs opened through Agent Tabs (⌘T, ⌘⇧T) are tracked.
- Status icons take the tab's text color. VS Code offers no way to color them.
- A finished tab and an idle one look the same: neither shows an icon.
- After you approve a permission, the alert stays until that tool finishes, because Claude Code has no hook for an approval.
- No hook marks a turn you stop with Esc, so its spinner clears when Claude Code next says it's waiting for input (about a minute later) or when you send the next prompt.

## Add your agent

Agent Tabs is agent-neutral. An agent needs two things:

1. An adapter in `extension/src/agents/` that builds its start, resume and picker commands. See `claude.ts`; it's 15 lines.
2. Something on the agent's side that writes `{"sessionId": "...", "cwd": "..."}` to `~/.agent-tabs/sessions/$AGENT_TABS_ID.json` when a session starts. For Claude Code that's the hook in `claude-plugin/`.
3. Optional, for the status icons: something that sends `OSC 9;4` (`3` working, `4` needs you, `0` done, `2` error) to the agent's terminal. For Claude Code that's `claude-plugin/hooks/status.sh`.

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
