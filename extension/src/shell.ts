/** Quote one argument for a POSIX shell (sh, bash, zsh). */
export function quote(arg: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Join a command and its arguments into one shell line. */
export function commandLine(parts: string[]): string {
  return parts.map(quote).join(" ");
}
