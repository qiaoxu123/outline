import type { CustomDocument } from "./customData";
import {
  isPersonalNotesCollectionName,
  buildPersonalDirectoryParams,
  findPersonalRoot,
  parseDocumentInfoResult,
  parsePersonalRootResult,
  selectPersonalDirectoryDocuments,
  sortPersonalDocuments,
} from "./PersonalNotesHelpers";

function document(
  id: string,
  title: string,
  children: CustomDocument[] = []
): CustomDocument {
  return { id, title, children };
}

describe("PersonalNotesHelpers", () => {
  it("recognizes only the dedicated Personal collection (not arbitrary member spaces)", () => {
    expect(isPersonalNotesCollectionName("Personal")).toBe(true);
    expect(isPersonalNotesCollectionName("  personal  ")).toBe(true);
    expect(isPersonalNotesCollectionName("PERSONAL")).toBe(true);
    expect(isPersonalNotesCollectionName("Personal Research")).toBe(false);
    expect(isPersonalNotesCollectionName("成员空间")).toBe(false);
  });


  it("limits every directory request to the configured root and collection", () => {
    expect(
      buildPersonalDirectoryParams({
        docId: "current-member-root",
        collectionId: "members-collection",
      })
    ).toEqual({
      parentDocumentId: "current-member-root",
      sort: "title",
      direction: "ASC",
      limit: 100,
      offset: 0,
    });
  });

  it("rejects documents outside the configured collection and parent", () => {
    const root = {
      docId: "current-member-root",
      collectionId: "members-collection",
    };
    const inside = {
      ...document("inside", "1. 论文"),
      collectionId: root.collectionId,
      parentDocumentId: root.docId,
    };
    const sibling = {
      ...document("sibling", "其他成员的文档"),
      collectionId: root.collectionId,
      parentDocumentId: "someone-else",
    };
    const otherCollection = {
      ...document("other", "其他集合的文档"),
      collectionId: "another-collection",
      parentDocumentId: root.docId,
    };

    expect(
      selectPersonalDirectoryDocuments(
        [inside, sibling, otherCollection],
        root
      ).map((item) => item.id)
    ).toEqual(["inside"]);
  });

  it("sorts numbered member directories naturally", () => {
    const items = [
      document("ten", "10. 归档"),
      document("todo", "待办事项"),
      document("two", "2. 科研想法"),
      document("one", "1. 论文阅读"),
    ];

    expect(sortPersonalDocuments(items).map((item) => item.id)).toEqual([
      "one",
      "two",
      "ten",
      "todo",
    ]);
  });

  it("finds only the current member's exact directory in the member space", () => {
    const tree = [
      document("teachers", "老师", [
        document("someone-else", "孙泽敏"),
        document("mine", " 乔旭 ", [document("paper", "论文")]),
      ]),
    ];

    expect(findPersonalRoot(tree, "乔旭")?.id).toBe("mine");
    expect(findPersonalRoot(tree, "乔")?.id).toBeUndefined();
  });

  it("accepts only a valid desktop root result", () => {
    expect(
      parsePersonalRootResult({
        ok: true,
        data: { docId: "mine", collectionId: "members" },
      })
    ).toEqual({ docId: "mine", collectionId: "members" });
    expect(parsePersonalRootResult({ ok: true, data: null })).toBeNull();
    expect(
      parsePersonalRootResult({ ok: true, data: { docId: "mine" } })
    ).toBeNull();
    expect(
      parsePersonalRootResult({
        ok: false,
        data: { docId: "mine", collectionId: "members" },
      })
    ).toBeNull();
  });

  it("unwraps the current documents.info response envelope", () => {
    const mine = document("mine", "乔旭");
    expect(
      parseDocumentInfoResult({ ok: true, data: { document: mine } })
    ).toEqual(mine);
    expect(parseDocumentInfoResult({ ok: true, data: mine })).toBeNull();
  });
});
