import type { History } from "history";
import type TabsStore from "~/stores/TabsStore";
import { documentTabId, openInTab } from "./tabNavigation";

describe("documentTabId", () => {
  test("shares one identity between read and edit routes", () => {
    expect(documentTabId("/doc/abc")).toBe("/doc/abc");
    expect(documentTabId("/doc/abc/edit")).toBe("/doc/abc");
  });

  test("does not collapse document history routes into the document tab", () => {
    expect(documentTabId("/doc/abc/history/rev-1")).toBe(
      "/doc/abc/history/rev-1"
    );
  });
});

describe("openInTab", () => {
  test("uses one stable identity for a document opened from different routes", () => {
    const push = vi.fn();
    const open = vi.fn();
    const history = { push } as unknown as History;
    const tabs = {
      open,
    } as unknown as TabsStore;

    openInTab(history, tabs, {
      id: "document-id",
      url: "/doc/science-guide/edit",
      title: "Science guide",
    });

    expect(open).toHaveBeenCalledWith({
      id: "/doc/science-guide",
      url: "/doc/science-guide/edit",
      title: "Science guide",
    });
    expect(push).toHaveBeenCalledWith("/doc/science-guide/edit");
  });

  test("preserves the personal-notes navigation context", () => {
    const push = vi.fn();
    const open = vi.fn();
    const history = { push } as unknown as History;
    const tabs = {
      open,
    } as unknown as TabsStore;

    openInTab(history, tabs, {
      id: "document-id",
      url: "/doc/science-guide",
      title: "Science guide",
      sidebarContext: "personal-notes",
    });

    expect(open).toHaveBeenCalledWith({
      id: "/doc/science-guide",
      url: "/doc/science-guide",
      title: "Science guide",
      sidebarContext: "personal-notes",
    });
    expect(push).toHaveBeenCalledWith({
      pathname: "/doc/science-guide",
      state: { sidebarContext: "personal-notes" },
    });
  });
});
