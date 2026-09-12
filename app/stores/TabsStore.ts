import { action, computed, observable } from "mobx";
import type RootStore from "~/stores/RootStore";
import type { SidebarContextType } from "~/components/Sidebar/components/SidebarContext";

export interface Tab {
  id: string;
  url: string;
  title: string;
  emoji?: string | null;
  pinned: boolean;
  sidebarContext?: SidebarContextType;
}

type StoredTabs = Record<string, Tab[]>;
const STORAGE_KEY = "outline.desktop.tabs.v1";

function tabIdentity(tab: Pick<Tab, "id" | "url">): string {
  return tab.url.startsWith("/doc/") ? tab.url.replace(/\/edit$/, "") : tab.id;
}

function normalizeTabs(tabs: Tab[]): Tab[] {
  const byIdentity = new Map<string, Tab[]>();
  for (const tab of tabs) {
    const id = tabIdentity(tab);
    byIdentity.set(id, [...(byIdentity.get(id) ?? []), tab]);
  }
  return Array.from(byIdentity.entries()).map(([id, entries]) => {
    const tab = entries[entries.length - 1];
    return entries.length === 1
      ? tab
      : {
          ...tab,
          id,
          pinned: entries.some((entry) => entry.pinned),
        };
  });
}

function readStoredTabs(): StoredTabs {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export default class TabsStore {
  private rootStore: RootStore;
  @observable
  private stored: StoredTabs = Object.fromEntries(
    Object.entries(readStoredTabs()).map(([scope, tabs]) => [
      scope,
      normalizeTabs(tabs),
    ])
  );

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
  }

  private get scope(): string {
    return this.rootStore.auth?.currentTeamId ?? window.location.host;
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stored));
  }

  @computed get tabs(): Tab[] {
    return this.stored[this.scope] ?? [];
  }

  private setTabs(tabs: Tab[]): void {
    this.stored[this.scope] = [
      ...tabs.filter((tab) => tab.pinned),
      ...tabs.filter((tab) => !tab.pinned),
    ];
    this.persist();
  }

  @action
  open(tab: Omit<Tab, "pinned"> & { pinned?: boolean }): void {
    const normalized = {
      ...tab,
      pinned: tab.pinned ?? false,
    };
    if (this.tabs.some((item) => tabIdentity(item) === tabIdentity(normalized)))
      return;
    this.setTabs([...this.tabs, normalized]);
  }

  @action
  update(id: string, patch: Partial<Tab>): void {
    this.setTabs(
      this.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab))
    );
  }

  @action
  close(id: string): string | null {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return null;
    const next = this.tabs.filter((tab) => tab.id !== id);
    this.setTabs(next);
    return next[Math.min(index, next.length - 1)]?.id ?? null;
  }

  @action
  togglePin(id: string): void {
    this.setTabs(
      this.tabs.map((tab) =>
        tab.id === id ? { ...tab, pinned: !tab.pinned } : tab
      )
    );
  }

  @action
  move(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const tabs = [...this.tabs];
    const from = tabs.findIndex((tab) => tab.id === fromId);
    const to = tabs.findIndex((tab) => tab.id === toId);
    if (from < 0 || to < 0 || tabs[from].pinned !== tabs[to].pinned) return;
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    this.setTabs(tabs);
  }

  @action
  closeOthers(id: string): void {
    this.setTabs(this.tabs.filter((tab) => tab.pinned || tab.id === id));
  }

  @action
  closeAll(): void {
    this.setTabs(this.tabs.filter((tab) => tab.pinned));
  }
}
