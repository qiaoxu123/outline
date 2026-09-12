import { SidebarExpansionState } from "./SidebarExpansionContext";

describe("SidebarExpansionState", () => {
  test("removes automatic expansion when navigation leaves the tree", () => {
    const state = new SidebarExpansionState();

    state.syncAutoExpandedPath(["member", "personal-root", "note"]);
    expect([...state.expandedIds]).toEqual(["member", "personal-root", "note"]);

    state.syncAutoExpandedPath([]);
    expect([...state.expandedIds]).toEqual([]);
  });

  test("preserves nodes explicitly expanded by the user", () => {
    const state = new SidebarExpansionState();

    state.expand("member");
    state.syncAutoExpandedPath(["member", "personal-root"]);
    state.syncAutoExpandedPath([]);

    expect([...state.expandedIds]).toEqual(["member"]);
  });
});
