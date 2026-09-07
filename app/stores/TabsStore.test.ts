import TabsStore from "./TabsStore";

describe("TabsStore", () => {
  beforeEach(() => {
    localStorage.removeItem("outline.desktop.tabs.v1");
  });

  const createStore = (teamId = "team-a") =>
    new TabsStore({ auth: { currentTeamId: teamId } } as any);

  test("persists tabs independently per team", () => {
    const first = createStore("team-a");
    first.open({ id: "doc-a", url: "/doc/a", title: "A" });

    const second = createStore("team-b");
    expect(second.tabs).toEqual([]);
    second.open({ id: "doc-b", url: "/doc/b", title: "B" });

    expect(createStore("team-a").tabs.map((tab) => tab.id)).toEqual(["doc-a"]);
    expect(createStore("team-b").tabs.map((tab) => tab.id)).toEqual(["doc-b"]);
  });

  test("keeps pinned tabs first and protects them from close all", () => {
    const store = createStore();
    store.open({ id: "doc-a", url: "/doc/a", title: "A" });
    store.open({ id: "doc-b", url: "/doc/b", title: "B", pinned: true });
    store.togglePin("doc-a");

    expect(store.tabs.map((tab) => tab.id)).toEqual(["doc-b", "doc-a"]);
    store.closeAll();
    expect(store.tabs.map((tab) => tab.id)).toEqual(["doc-b", "doc-a"]);
  });

  test("returns the nearest tab when closing the active tab", () => {
    const store = createStore();
    store.open({ id: "doc-a", url: "/doc/a", title: "A" });
    store.open({ id: "doc-b", url: "/doc/b", title: "B" });
    store.open({ id: "doc-c", url: "/doc/c", title: "C" });

    expect(store.close("doc-b")).toBe("doc-c");
    expect(store.close("doc-c")).toBe("doc-a");
  });

  test("migrates legacy tabs that represent the same document URL", () => {
    localStorage.setItem(
      "outline.desktop.tabs.v1",
      JSON.stringify({
        "team-a": [
          { id: "document-id", url: "/doc/science-guide", title: "Science guide", pinned: false },
          { id: "/doc/science-guide/edit", url: "/doc/science-guide/edit", title: "Science guide", pinned: false },
        ],
      })
    );

    const store = createStore();

    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].id).toBe("/doc/science-guide");
  });

  test("deduplicates a document opened in read and edit mode", () => {
    const store = createStore();
    store.open({ id: "/doc/abc", url: "/doc/abc", title: "ABC" });
    store.open({
      id: "/doc/abc/edit",
      url: "/doc/abc/edit",
      title: "ABC",
    });

    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].id).toBe("/doc/abc");
  });
});
