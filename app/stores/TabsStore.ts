import { action, computed, observable } from "mobx";
import type RootStore from "~/stores/RootStore";

export interface Tab {
  id: string;
  url: string;
  title: string;
  emoji?: string | null;
  pinned: boolean;
}

type StoredTabs = Record<string, Tab[]>;
const STORAGE_KEY = "outline.desktop.tabs.v1";

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
  private stored: StoredTabs = readStoredTabs();

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
    if (this.tabs.some((item) => item.id === tab.id)) return;
    this.setTabs([...this.tabs, { ...tab, pinned: tab.pinned ?? false }]);
  }

  @action
  update(id: string, patch: Partial<Tab>): void {
    this.setTabs(this.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
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
    this.setTabs(this.tabs.map((tab) => (tab.id === id ? { ...tab, pinned: !tab.pinned } : tab)));
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
