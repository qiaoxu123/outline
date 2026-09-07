import { documentTabId, openInTab } from "./tabNavigation";

describe("documentTabId", () => {
  test("shares one identity between read and edit routes", () => {
    expect(documentTabId("/doc/abc")).toBe("/doc/abc");
    expect(documentTabId("/doc/abc/edit")).toBe("/doc/abc");
  });

  test("does not collapse document history routes into the document tab", () => {
    expect(documentTabId("/doc/abc/history/rev-1")).toBe(
      "/doc/abc/history/rev-1",
    );
  });
});

describe("openInTab", () => {
  test("uses one stable identity for a document opened from different routes", () => {
    const history = { push: vi.fn() } as any;
    const tabs = {
      open: vi.fn(),
    } as any;

    openInTab(history, tabs, {
      id: "document-id",
      url: "/doc/science-guide/edit",
      title: "Science guide",
    });

    expect(tabs.open).toHaveBeenCalledWith({
      id: "/doc/science-guide",
      url: "/doc/science-guide/edit",
      title: "Science guide",
    });
    expect(history.push).toHaveBeenCalledWith("/doc/science-guide/edit");
  });
});
