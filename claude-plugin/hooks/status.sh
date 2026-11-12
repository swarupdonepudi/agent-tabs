#!/bin/sh
# Agent Tabs: show what Claude is doing on its VS Code terminal tab.
#
# Claude Code runs this on the events below, with the event name as $1 and the
# event as JSON on stdin. The script answers with a `terminalSequence` that
# Claude writes to its own terminal: an OSC 9;4 progress signal. VS Code draws
# it in the tab title through `${progress}`:
#
#   working    9;4;3  spinning icon
#   needs you  9;4;4  alert icon
#   done       9;4;0  no icon
#   error      9;4;2  error icon
#
# Outside VS Code (and Cursor, which reports itself as vscode) it does nothing.

[ "$TERM_PROGRAM" = "vscode" ] || { cat >/dev/null; exit 0; }

event="$1"
input=$(cat)

# The first value of a top-level string field. Claude writes these fields
# before tool_input and tool_response, so the first match is the real one.
field() {
  printf '%s' "$input" |
    grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -n 1 |
    sed 's/.*:[[:space:]]*"\([^"]*\)"$/\1/'
}

state=""
case "$event" in
  UserPromptSubmit | PostToolUse | PostToolUseFailure) state=3 ;;
  PreToolUse)
    case "$(field tool_name)" in
      AskUserQuestion | ExitPlanMode) state=4 ;;
      *) state=3 ;;
    esac
    ;;
  PermissionRequest) state=4 ;;
  Notification)
    case "$(field notification_type)" in
      permission_prompt | worker_permission_prompt | elicitation_dialog | elicitation_url_dialog | agent_needs_input) state=4 ;;
      # Claude says it has waited a minute for input. No hook marks an
      # interrupted turn (Esc), so clear a spinner that outlived its turn.
      idle_prompt) state=idle ;;
      *) exit 0 ;;
    esac
    ;;
  Stop | SessionStart | SessionEnd) state=0 ;;
  StopFailure) state=2 ;;
  *) exit 0 ;;
esac

# Remember each session's last state, so the idle notice can tell a stale
# spinner (clear it) from an open question (keep the alert).
sid=$(field session_id)
case "$sid" in
  "" | *[!A-Za-z0-9-]*) memo="" ;;
  *) memo="${AGENT_TABS_HOME:-$HOME/.agent-tabs}/status/$sid" ;;
esac

if [ "$state" = "idle" ]; then
  [ -n "$memo" ] && [ "$(cat "$memo" 2>/dev/null)" = "3" ] || exit 0
  state=0
fi

if [ -n "$memo" ]; then
  if [ "$event" = "SessionEnd" ]; then
    rm -f "$memo"
  else
    mkdir -p "${memo%/*}" 2>/dev/null && printf '%s' "$state" >"$memo" 2>/dev/null
  fi
fi

printf '{"terminalSequence":"\\u001b]9;4;%s\\u0007","suppressOutput":true}\n' "$state"
exit 0
