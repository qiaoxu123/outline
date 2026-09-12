import {
  activeDocumentIdForSidebarTree,
  isActiveInSidebarContext,
} from "./SidebarContext";

describe("activeDocumentIdForSidebarTree", () => {
  test("does not expand the collections tree for a personal-notes navigation", () => {
    expect(
      activeDocumentIdForSidebarTree(
        "document-id",
        "personal-notes",
        "collections"
      )
    ).toBeUndefined();
  });

  test("expands the tree matching the navigation context", () => {
    expect(
      activeDocumentIdForSidebarTree(
        "document-id",
        "collections",
        "collections"
      )
    ).toBe("document-id");
  });

  test("keeps the historical collections fallback without a context", () => {
    expect(
      activeDocumentIdForSidebarTree("document-id", undefined, "collections")
    ).toBe("document-id");
  });
});

describe("isActiveInSidebarContext", () => {
  test("highlights a personal note only for personal-notes navigation", () => {
    expect(
      isActiveInSidebarContext(true, "personal-notes", "personal-notes")
    ).toBe(true);
    expect(
      isActiveInSidebarContext(true, "collections", "personal-notes")
    ).toBe(false);
  });
});
