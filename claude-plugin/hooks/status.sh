#!/bin/sh
# Agent Tabs: show what Claude is doing on its VS Code terminal tab.
#
# Claude Code runs this on the events below, with the event name as $1 and the
# event as JSON on stdin. The script writes an OSC 9;4 progress signal to the
# terminal of the Claude that runs it, and VS Code draws it in the tab title
# through `${progress}`:
#
#   working    9;4;3  spinning icon (also while a background agent runs)
#   needs you  9;4;4  alert icon
#   done       9;4;0  no icon
#   error      9;4;2  error icon
#
# Outside VS Code (and Cursor, which reports itself as vscode), and for a
# headless `claude -p`, it does nothing.

[ "$TERM_PROGRAM" = "vscode" ] || { cat >/dev/null; exit 0; }

# shellcheck source=lib.sh source-path=SCRIPTDIR
. "$(dirname "$0")/lib.sh"

event="$1"
input=$(cat)

# The first value of a top-level string field. Claude writes these fields
# before tool_input and tool_response, so the first match is the real one.
field() {
  printf '%s' "$input" |
    grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -n 1 |
    sed 's/.*:[[:space:]]*"\([^"]*\)"$/\1/'
}

safe() {
  case "$1" in
    "" | *[!A-Za-z0-9_-]*) return 1 ;;
  esac
}

sid=$(field session_id)
safe "$sid" || exit 0
dir="${AGENT_TABS_HOME:-$HOME/.agent-tabs}/status"
memo="$dir/$sid"          # the session's last state: 3, 4, 0, 2 or bg
agents="$dir/$sid.agents" # one file per running subagent
ttyfile="$dir/$sid.tty"   # the session's terminal, found once
mkdir -p "$dir" 2>/dev/null || exit 0

last=$(cat "$memo" 2>/dev/null)

# A subagent still counts after 3 hours only if it said so since; this keeps a
# lost SubagentStop from leaving a tab spinning forever.
agents_running() {
  [ -n "$(find "$agents" -type f -mmin -180 2>/dev/null | head -n 1)" ]
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
      # Claude says it has waited a minute for input. No hook marks a turn
      # stopped with Esc, so clear a spinner that outlived its turn.
      idle_prompt)
        [ "$last" = "3" ] || exit 0
        state=0
        ;;
      *) exit 0 ;;
    esac
    ;;
  SubagentStart)
    aid=$(field agent_id)
    safe "$aid" && mkdir -p "$agents" 2>/dev/null && : >"$agents/$aid"
    exit 0
    ;;
  SubagentStop)
    aid=$(field agent_id)
    safe "$aid" && rm -f "$agents/$aid"
    # The turn ended while agents ran; the last one out clears the spinner.
    if [ "$last" != "bg" ] || agents_running; then exit 0; fi
    state=0
    ;;
  Stop)
    if agents_running; then state="bg"; else state=0; fi
    ;;
  SessionStart)
    # A new or resumed process: no agent of an earlier one is still running.
    rm -rf "$agents" "$ttyfile"
    state=0
    ;;
  SessionEnd) state=0 ;;
  StopFailure) state=2 ;;
  *) exit 0 ;;
esac

tty=$(cat "$ttyfile" 2>/dev/null)
if [ -z "$tty" ] || [ -n "${AGENT_TABS_TTY+set}" ]; then
  tty=$(claude_tty) || { rm -f "$ttyfile"; exit 0; }
  printf '%s' "$tty" >"$ttyfile" 2>/dev/null
fi

if [ "$event" = "SessionEnd" ]; then
  rm -rf "$memo" "$agents" "$ttyfile"
else
  printf '%s' "$state" >"$memo" 2>/dev/null
fi

[ "$state" = "bg" ] && state=3
printf '\033]9;4;%s\007' "$state" >>"$tty" 2>/dev/null
exit 0
