# shellcheck shell=sh
# Agent Tabs: helpers shared by the hooks. Sourced, not run.

# Finds the terminal of the Claude Code process that runs this hook: the
# nearest `claude` among the hook's parent processes.
#   prints /dev/<tty>, returns 0  an interactive Claude in a terminal tab
#   returns 1                     a headless Claude (`claude -p`), no terminal
#   returns 2                     no Claude found above this hook
# AGENT_TABS_TTY, when set, replaces the search (tests); empty means headless.
claude_tty() {
  if [ -n "${AGENT_TABS_TTY+set}" ]; then
    [ -n "$AGENT_TABS_TTY" ] || return 1
    printf '%s' "$AGENT_TABS_TTY"
    return 0
  fi
  _at_pid=$PPID
  _at_hops=0
  while [ "$_at_hops" -lt 6 ] && [ "${_at_pid:-0}" -gt 1 ] 2>/dev/null; do
    # shellcheck disable=SC2046 # split "tty comm" into two words on purpose
    set -- $(ps -o tty= -o comm= -p "$_at_pid" 2>/dev/null)
    case "${2:-}" in
      claude | */claude | */claude/versions/*)
        case "${1:-}" in
          "" | "?" | "??") return 1 ;;
          *) printf '/dev/%s' "$1"; return 0 ;;
        esac
        ;;
    esac
    _at_pid=$(ps -o ppid= -p "$_at_pid" 2>/dev/null | tr -d ' ')
    _at_hops=$((_at_hops + 1))
  done
  return 2
}
