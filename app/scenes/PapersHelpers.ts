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
};

export type Rating = {
  average: number;
  count: number;
  mine: number | null;
};

export type PaperScope = "all" | "liked" | "history";
export type ReadState = "unread" | "reading" | "read";
export type PaperSort = "updated" | "views" | "likes" | "score" | "title";

export type PaperListOptions = {
  query: string;
  tag: string | null;
  readFilter: ReadState | "";
  scope: PaperScope;
  sort: PaperSort;
};

type FilterInput = {
  papers: Paper[];
  metas: Record<string, Meta>;
  read: Record<string, string>;
  likes: Record<string, boolean | string>;
  viewed: Record<string, string>;
  viewCounts: Record<string, number>;
  ratings: Record<string, Rating>;
  options: PaperListOptions;
};

export function filterAndSortPapers({
  papers,
  metas,
  read,
  likes,
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
    if (options.tag && !(meta?.tags ?? []).includes(options.tag)) {
      return false;
    }
    if (!query) {
      return true;
    }

    const haystack = [
      paper.title,
      meta?.enTitle,
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
      return (viewCounts[b.id] ?? 0) - (viewCounts[a.id] ?? 0);
    }
    if (options.sort === "likes") {
      return Number(!!likes[b.id]) - Number(!!likes[a.id]);
    }
    if (options.sort === "score") {
      return (ratings[b.id]?.average ?? 0) - (ratings[a.id]?.average ?? 0);
    }
    return timestamp(b) - timestamp(a);
  });
}
