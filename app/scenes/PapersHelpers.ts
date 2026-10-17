import type { CustomDocument } from "./customData";

export type Paper = CustomDocument & {
  emoji?: string | null;
  year?: number | null;
  month?: number | null;
  topic?: string | null;
  source?: string;
};

export type Meta = {
  tags: string[];
  venue: string | null;
  link: string | null;
  code: string | null;
  enTitle: string | null;
  authors: string | null;
  org: string | null;
  parsed: boolean;
};

export type Rating = {
  average: number;
  count: number;
  mine: number | null;
};

export type PaperScope = "all" | "liked" | "history";
export type ReadState = "unread" | "reading" | "read";
export type PaperSort = "updated" | "views" | "likes" | "score" | "title";

/** Advance even an implicit unread state on the first click. */
export function nextPaperReadState(state?: string): ReadState {
  return state === "reading" ? "read" : state === "read" ? "unread" : "reading";
}

/** Update only the current user's contribution to an aggregate rating. */
export function optimisticPaperRating(previous: Rating | undefined, mine: number | null): Rating {
  const count = (previous?.count ?? 0) - (previous?.mine ? 1 : 0) + (mine ? 1 : 0);
  const sum = (previous?.average ?? 0) * (previous?.count ?? 0) - (previous?.mine ?? 0) + (mine ?? 0);
  return { average: count > 0 ? sum / count : 0, count, mine };
}

export type PaperListOptions = {
  query: string;
  tag: string | null;
  year: number | null;
  month: number | null;
  readFilter: ReadState | "";
  scope: PaperScope;
  sort: PaperSort;
};

export type PaperMetadataCacheState = {
  savedAt: number;
  metadataSyncedAt?: number;
  complete?: boolean;
};

export type PaperMetadataRefreshPlan =
  | { mode: "full" }
  | { mode: "changed"; since: string };

type FilterInput = {
  papers: Paper[];
  metas: Record<string, Meta>;
  read: Record<string, string>;
  likes: Record<string, boolean | string>;
  likeCounts?: Record<string, number>;
  viewed: Record<string, string>;
  viewCounts: Record<string, number>;
  ratings: Record<string, Rating>;
  options: PaperListOptions;
};

const emptyValues = new Set([
  "",
  "-",
  "--",
  "—",
  "n/a",
  "na",
  "null",
  "暂无",
  "未知",
]);

function cleanValue(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const cleaned = value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/<br\s*\/?>/gi, ", ")
    .trim();
  return emptyValues.has(cleaned.toLowerCase()) ? null : cleaned;
}

function extractUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return (
    /\((https?:\/\/[^)\s]+)\)/.exec(value)?.[1] ??
    /(https?:\/\/[^\s|)>]+)/.exec(value)?.[1] ??
    null
  );
}

function metaFromFields(fields: Map<string, string>): Meta {
  const pick = (...keys: string[]) => {
    const normalized = keys.map((key) => key.toLowerCase());
    return (
      [...fields].find(([name]) =>
        normalized.some((key) => name === key || name.includes(key))
      )?.[1] ?? null
    );
  };
  const title = cleanValue(
    pick(
      "英文标题",
      "原文标题",
      "原标题",
      "英文题目",
      "论文标题",
      "english title",
      "title"
    )
  );
  const tags = (
    cleanValue(pick("主题标签", "领域", "方向", "标签", "tags")) ?? ""
  )
    .split(/[,，、;；|]/)
    .map((tag) => cleanValue(tag))
    .filter((tag): tag is string => !!tag);

  return {
    tags: [...new Set(tags)],
    venue: cleanValue(pick("期刊会议", "发表时间", "发表", "venue")),
    link: extractUrl(pick("论文链接", "原文链接", "paper url", "paper link")),
    code: extractUrl(pick("代码仓库", "代码", "源码", "github", "code")),
    enTitle: title,
    authors: cleanValue(pick("论文作者", "作者", "authors", "author")),
    org: cleanValue(
      pick("作者单位", "作者机构", "研究机构", "机构", "affiliation")
    ),
    parsed: fields.size > 0,
  };
}

/** Parse the compact metadata block used by papers stored in Outline. */
export function parsePaperMeta(text: string | undefined): Meta {
  const fields = new Map<string, string>();
  for (const rawLine of (text ?? "").split("\n").slice(0, 80)) {
    const line = rawLine.trim();
    const table = /^\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (table && !/^[-\s:]+$/.test(table[1])) {
      fields.set(table[1].trim().toLowerCase(), table[2].trim());
      continue;
    }
    const plain = /^(?:[-*]\s*)?([^:|：]{2,30})\s*[:：]\s*(.+)$/.exec(line);
    if (plain) {
      fields.set(plain[1].trim().toLowerCase(), plain[2].trim());
    }
  }

  return metaFromFields(fields);
}

type PaperDataNode = {
  type?: string;
  text?: string;
  content?: PaperDataNode[];
};

function dataNodeText(node: PaperDataNode): string {
  return node.text ?? (node.content ?? []).map(dataNodeText).join("");
}

/** Parse metadata directly from the ProseMirror payload returned by API v3. */
export function parsePaperData(data: unknown): Meta {
  const fields = new Map<string, string>();
  const pending: PaperDataNode[] =
    data && typeof data === "object" ? [data as PaperDataNode] : [];
  while (pending.length) {
    const node = pending.shift()!;
    const type = node.type?.replace(/[_-]/g, "").toLowerCase();
    if (type === "tablerow" || type === "tr") {
      const cells = node.content ?? [];
      const name = dataNodeText(cells[0] ?? {}).trim();
      const value = dataNodeText(cells[1] ?? {}).trim();
      if (name && value) {
        fields.set(name.toLowerCase(), value);
      }
    }
    pending.unshift(...(node.content ?? []));
  }
  return metaFromFields(fields);
}

export function sumViewCounts(views: { count?: number }[]): number {
  return views.reduce(
    (total, view) => total + (typeof view.count === "number" ? view.count : 0),
    0
  );
}

/** Decide whether metadata needs a cold full scan or a small delta query. */
export function planPaperMetadataRefresh(
  cache: PaperMetadataCacheState | null
): PaperMetadataRefreshPlan {
  if (!cache?.complete) {
    return { mode: "full" };
  }
  const checkpoint = cache.metadataSyncedAt ?? cache.savedAt;
  if (!Number.isFinite(checkpoint) || checkpoint <= 0) {
    return { mode: "full" };
  }
  return { mode: "changed", since: new Date(checkpoint).toISOString() };
}

/**
 * Pick a bounded set of stale paper view counters. Missing counters are
 * refreshed first, then the oldest successful checks.
 */
export function selectPaperViewRefreshIds(
  papers: Pick<Paper, "id">[],
  checkedAt: Record<string, number>,
  now: number,
  ttl: number,
  limit: number
): string[] {
  return papers
    .map((paper, index) => ({
      id: paper.id,
      checkedAt: checkedAt[paper.id] ?? Number.NEGATIVE_INFINITY,
      index,
    }))
    .filter((item) => now - item.checkedAt >= ttl)
    .sort((a, b) => a.checkedAt - b.checkedAt || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map((item) => item.id);
}

/**
 * Apply an incremental checkpoint client-side for Outline servers that do not
 * yet understand the document filter DSL.
 */
export function selectChangedPaperDocuments<
  T extends { id: string; updatedAt?: string },
>(
  documents: T[],
  since: string
): {
  changed: T[];
  reachedCheckpoint: boolean;
} {
  const checkpoint = new Date(since).getTime();
  const changed: T[] = [];
  let reachedCheckpoint = false;
  for (const document of documents) {
    const updatedAt = document.updatedAt
      ? new Date(document.updatedAt).getTime()
      : Number.NaN;
    if (!Number.isNaN(updatedAt) && updatedAt <= checkpoint) {
      reachedCheckpoint = true;
      continue;
    }
    changed.push(document);
  }
  return { changed, reachedCheckpoint };
}

export function filterAndSortPapers({
  papers,
  metas,
  read,
  likes,
  likeCounts = {},
  viewed,
  viewCounts,
  ratings,
  options,
}: FilterInput): Paper[] {
  const query = options.query.trim().toLowerCase();
  const eligible = papers.filter((paper) => {
    const meta = metas[paper.id];
    const state = (read[paper.id] as ReadState | undefined) ?? "unread";
    if (options.scope === "liked" && !likes[paper.id]) {
      return false;
    }
    if (options.scope === "history" && !viewed[paper.id]) {
      return false;
    }
    if (options.readFilter && state !== options.readFilter) {
      return false;
    }
    if (options.year && paper.year !== options.year) {
      return false;
    }
    if (options.month && paper.month !== options.month) {
      return false;
    }
    if (options.tag && !(meta?.tags ?? []).includes(options.tag)) {
      return false;
    }
    if (!query) {
      return true;
    }

    const haystack = [
      paper.title,
      meta?.enTitle,
      meta?.authors,
      meta?.org,
      meta?.venue,
      meta?.tags.join(" "),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });

  const timestamp = (paper: Paper) => {
    const value = paper.updatedAt;
    const parsed = value ? new Date(value).getTime() : 0;
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  if (options.scope === "history") {
    return eligible.sort(
      (a, b) =>
        new Date(viewed[b.id]).getTime() - new Date(viewed[a.id]).getTime()
    );
  }

  return eligible.sort((a, b) => {
    if (options.sort === "title") {
      return a.title.localeCompare(b.title, "zh");
    }
    if (options.sort === "views") {
      return (viewCounts[b.id] ?? 0) - (viewCounts[a.id] ?? 0) || timestamp(b) - timestamp(a);
    }
    if (options.sort === "likes") {
      // Team-wide popularity, not just papers the current user liked.
      const score = (id: string) => likeCounts[id] ?? Number(!!likes[id]);
      return score(b.id) - score(a.id) || timestamp(b) - timestamp(a);
    }
    if (options.sort === "score") {
      return (ratings[b.id]?.average ?? 0) - (ratings[a.id]?.average ?? 0) ||
        (ratings[b.id]?.count ?? 0) - (ratings[a.id]?.count ?? 0) ||
        timestamp(b) - timestamp(a);
    }
    return timestamp(b) - timestamp(a);
  });
}

export function summarizePaperTags(
  tags: string[],
  limit: number
): { visible: string[]; hiddenCount: number } {
  const visible = tags.slice(0, Math.max(0, limit));
  return {
    visible,
    hiddenCount: Math.max(0, tags.length - visible.length),
  };
}
