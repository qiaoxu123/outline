import type { CustomCollection, CustomDocument } from "./customData";
import type { Paper } from "./PapersHelpers";

const PAPER_MARKER = "📖";
const RECOMMENDATIONS = "推荐阅读";
const FEATURED_FOLDERS = new Set([
  "精选专题",
  "精选论文",
  "会议论文精选",
  "同行成果",
]);

export type PaperSourceTree = {
  collection: CustomCollection;
  tree: CustomDocument[];
};

export type PaperSourceIndex = {
  papers: Paper[];
  sourceCollectionIds: string[];
};

function flatten(nodes: CustomDocument[]): CustomDocument[] {
  const result: CustomDocument[] = [];
  const pending = [...nodes];
  while (pending.length) {
    const node = pending.shift()!;
    result.push(node);
    pending.unshift(...(node.children ?? []));
  }
  return result;
}

/** In 推荐阅读, year/month headings are folders and their direct documents
 * are entries. Non-📖 paper titles are historically valid in this area. */
function collectRecommendations(
  nodes: CustomDocument[],
  year: number | null = null,
  month: number | null = null
): Paper[] {
  return nodes.flatMap((node) => {
    const title = node.title.trim();
    const y = /^(\d{4})\s*年/.exec(title);
    const m = /^(\d{1,2})\s*月/.exec(title);
    if (y) {
      return collectRecommendations(node.children ?? [], Number(y[1]), month);
    }
    if (m) {
      return collectRecommendations(node.children ?? [], year, Number(m[1]));
    }
    return [{ ...node, children: undefined, year, month }];
  });
}

/** Topic directories contain both index pages and papers. Descend even
 * below 📖 documents because users can file papers under other papers. */
function collectMarked(
  nodes: CustomDocument[],
  topic: string | null = null,
  source = "featured"
): Paper[] {
  return nodes.flatMap((node) => {
    const title = node.title.trim();
    if (title.startsWith(PAPER_MARKER)) {
      return [
        { ...node, children: undefined, title, topic, source },
        ...collectMarked(node.children ?? [], topic, source),
      ];
    }
    return collectMarked(node.children ?? [], topic ?? title, source);
  });
}

/**
 * Index known paper locations by their *document tree*, not only by collection
 * name. 精选专题 is usually a folder in 扩展学习 rather than its own collection.
 * Do not index arbitrary 📖 documents from Personal or other unrelated spaces.
 */
export function indexPaperSources(
  sources: PaperSourceTree[]
): PaperSourceIndex {
  const found: Paper[] = [];
  const sourceCollectionIds = new Set<string>();
  for (const { collection, tree } of sources) {
    const nodes = flatten(tree);
    let isSource = false;
    for (const node of nodes) {
      const title = node.title.trim();
      if (title === RECOMMENDATIONS) {
        isSource = true;
        found.push(...collectRecommendations(node.children ?? []));
      } else if (FEATURED_FOLDERS.has(title)) {
        isSource = true;
        found.push(...collectMarked(node.children ?? [], title));
      }
    }
    if (collection.name.trim() === "精选专题") {
      isSource = true;
      found.push(...collectMarked(tree));
    }
    if (collection.name.trim() === "组内工作") {
      isSource = true;
      found.push(
        ...collectMarked(tree, "组内工作", "internal").map((paper) => ({
          ...paper,
          topic: "组内工作",
        }))
      );
    }
    if (isSource) {
      sourceCollectionIds.add(collection.id);
    }
  }
  // A document may appear in multiple trees or sources; count its ID once.
  return {
    papers: [...new Map(found.map((paper) => [paper.id, paper])).values()],
    sourceCollectionIds: [...sourceCollectionIds],
  };
}
