import type { History } from "history";
import type TabsStore from "~/stores/TabsStore";

type OpenTab = {
  id: string;
  url: string;
  title: string;
  emoji?: string | null;
  pinned?: boolean;
};

/** Return the stable tab identity for a document, independent of view/edit mode. */
export function documentTabId(url: string): string {
  return url.startsWith("/doc/") ? url.replace(/\/edit$/, "") : url;
}

/** Open a resource in the unified official-Web tab model. */
export function openInTab(
  history: History,
  tabs: TabsStore,
  tab: OpenTab
): void {
  tabs.open({ ...tab, id: documentTabId(tab.url) });
  history.push(tab.url);
}
