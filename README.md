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
| ⌘⌥T / Ctrl+Alt+T | New tab in a folder you pick |

Close a tab, and it's forgotten. Quit VS Code (or let it crash), and every open tab comes back the next time you open the workspace.

### Open a tab in another folder

⌘T always opens in your default folder and never asks. When one session needs another folder, for example a second repository whose files you want the agent to complete and read, press ⌘⌥T. Pick one of your workspace folders, a folder you picked before, or **Browse…**. The agent starts in that folder, so its file completions, its `CLAUDE.md` and its project settings come from there. The pick never changes ⌘T's default, and the folder you picked last is selected first next time.

A tab outside the default folder gets a coloured icon, and each folder always gets the same colour, so it stands out in the tab list. The agent's own banner, inside the tab, shows the folder. When VS Code restarts, the tab comes back in its folder, with its colour.

To resume a past conversation from another folder, open a tab there with ⌘⌥T and use the agent's own resume (`/resume` in Claude Code). Agents list past conversations per folder.

### Why tabs don't show the folder name

Every tab starts in the default folder unless you pick another, so VS Code's folder name after each title repeated the same word on every row. Agent Tabs sets `terminal.integrated.tabs.description` to VS Code's own default without `${cwdFolder}`. To bring folder names back, add `${cwdFolder}` to that setting. VS Code can't show the name on just some tabs: the description is one template for every tab, so a tab in another folder is marked by its colour instead.

## See what each agent is doing

Each tab running Claude Code shows an icon before its title:

| Tab | Means |
|---|---|
| spinning icon | Claude is working, or a background agent it started still is |
| alert icon | Claude needs you: a question, a plan to approve, or a permission |
| no icon | Done, your turn |
| error icon | The turn stopped on an error |

It works in any VS Code terminal running `claude`, not only tabs opened through Agent Tabs, and it shows on background tabs too, so you can tell which one to switch to. Background shells (a dev server, a port-forward) don't count as working: they can run for hours.

Two other marks are not Agent Tabs': the `✳` before an idle conversation's name is Claude Code's own title, and a ⚠ at the far right of a tab is VS Code's terminal warning (hover it: usually "relaunch needed" after an extension changed the terminal's environment). Restarting that tab clears it.

How it works: on each Claude Code event (prompt submitted, tool started or finished, question asked, permission requested, agent started or finished, turn stopped) the plugin's hook finds the terminal of the Claude that ran it and writes an `OSC 9;4` progress signal to it. VS Code draws that signal in the tab title through the `${progress}` variable. A headless `claude -p` has no terminal, so a script or agent running one inside a tab changes nothing there. The extension turns the icon on by setting two defaults:

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
3. When the workspace opens, the extension rebuilds each saved tab in order, in the folder its conversation started in. The tab put on screen runs `claude --resume <id>` at once. Every other tab runs it the first time you open that tab.

Starting a conversation only once its tab is on screen does two things. Startup stays light, because ten saved tabs don't launch ten agents at once. And scrolling works: VS Code's terminal gets a broken scroll area when a terminal receives its history before it's first shown, and the wheel does nothing until the next reply.

Before rebuilding tabs, Agent Tabs waits up to 5 seconds for extensions that start with VS Code (Git, Copilot Chat and others) to finish adding their variables to new terminals. Otherwise VS Code marks every restored tab with a "relaunch needed" ⚠.

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
- A restored tab you haven't opened yet runs nothing, so it shows no status icon, and a conversation that scheduled its own wake-up waits until you open its tab.
- An extension that changes the terminal environment more than 5 seconds after startup can still make VS Code mark restored tabs "relaunch needed".
- Tabs come back in the order they were opened, not in an order you dragged them into.
- macOS and Linux. Windows needs a PowerShell version of the hook; contributions welcome.
- Only tabs opened through Agent Tabs (⌘T, ⌘⇧T, ⌘⌥T) are tracked.
- Four colours mark other folders, so with five or more of them open, two share a colour.
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
