import { claude } from "./claude";
import type { AgentAdapter } from "./types";

export type { AgentAdapter } from "./types";

const adapters: Record<string, AgentAdapter> = {
  [claude.id]: claude,
};

export function getAdapter(id: string): AgentAdapter | undefined {
  return adapters[id];
}

export function adapterIds(): string[] {
  return Object.keys(adapters);
}
