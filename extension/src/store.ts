/** One tab Agent Tabs opened and should bring back after a restart. */
export interface TabRecord {
  id: string;
  agent: string;
  /** Folder the tab opened in. */
  cwd: string;
  createdAt: string;
}

/** The slice of vscode.Memento the store needs, so tests can fake it. */
export interface KeyValue {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

const KEY = "agentTabs.tabs.v1";

/** Saved tabs for one workspace, in the order they were opened. */
export class TabStore {
  constructor(private readonly state: KeyValue) {}

  list(): TabRecord[] {
    const tabs = this.state.get<TabRecord[]>(KEY);
    return Array.isArray(tabs) ? tabs.filter(isTabRecord) : [];
  }

  has(id: string): boolean {
    return this.list().some((t) => t.id === id);
  }

  async add(tab: TabRecord): Promise<void> {
    const tabs = this.list().filter((t) => t.id !== tab.id);
    tabs.push(tab);
    await this.state.update(KEY, tabs);
  }

  async remove(id: string): Promise<boolean> {
    const tabs = this.list();
    const next = tabs.filter((t) => t.id !== id);
    if (next.length === tabs.length) return false;
    await this.state.update(KEY, next);
    return true;
  }

  async clear(): Promise<void> {
    await this.state.update(KEY, []);
  }
}

function isTabRecord(v: unknown): v is TabRecord {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return typeof t.id === "string" && typeof t.agent === "string" && typeof t.cwd === "string";
}
