#!/bin/sh
# Agent Tabs: remember which Claude Code conversation runs in which VS Code tab.
#
# Claude Code runs this on SessionStart ("start") and SessionEnd ("end") and
# passes the event as JSON on stdin. Agent Tabs gives every tab it opens an
# AGENT_TABS_ID; outside those tabs this script does nothing.
#
# It writes ~/.agent-tabs/sessions/<AGENT_TABS_ID>.json, which the VS Code
# extension reads when it rebuilds the tab after a restart.

[ -n "$AGENT_TABS_ID" ] || exit 0
case "$AGENT_TABS_ID" in
  *[!A-Za-z0-9-]*) exit 0 ;;
esac

# A headless `claude -p` started inside the tab (by a script or an agent) is
# not the tab's conversation and must not replace it.
. "$(dirname "$0")/lib.sh"
claude_tty >/dev/null
[ $? -eq 1 ] && exit 0

event="${1:-start}"
input=$(cat)

field() {
  printf '%s' "$input" | tr -d '\n' |
    sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1
}

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

dir="${AGENT_TABS_HOME:-$HOME/.agent-tabs}/sessions"
file="$dir/$AGENT_TABS_ID.json"
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ "$event" = "end" ]; then
  # Only a deliberate exit (/exit, Ctrl+D, logout) ends the tab's conversation.
  # A quit of VS Code kills Claude too, and must keep the conversation.
  case "$(field reason)" in
    prompt_input_exit | logout) ;;
    *) exit 0 ;;
  esac
  sid=""
else
  sid=$(field session_id)
  case "$sid" in
    "" | *[!A-Za-z0-9-]*) exit 0 ;;
  esac
fi

mkdir -p "$dir" || exit 0
cwd=$(json_escape "$(pwd)")
tmp="$dir/.$AGENT_TABS_ID.$$"
if [ -n "$sid" ]; then
  sid_json="\"$sid\""
else
  sid_json="null"
fi
printf '{"tabId":"%s","agent":"claude","sessionId":%s,"cwd":"%s","updatedAt":"%s"}\n' \
  "$AGENT_TABS_ID" "$sid_json" "$cwd" "$now" >"$tmp" && mv "$tmp" "$file"
exit 0
