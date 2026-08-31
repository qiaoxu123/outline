import type { History } from "history";
import type TabsStore from "~/stores/TabsStore";

type OpenTab = {
  id: string;
  url: string;
  title: string;
  emoji?: string | null;
  pinned?: boolean;
};

/** Open a resource in the unified official-Web tab model. */
export function openInTab(
  history: History,
  tabs: TabsStore,
  tab: OpenTab
): void {
  tabs.open(tab);
  history.push(tab.url);
}
