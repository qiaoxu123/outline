import {
  AcademicCapIcon,
  CodeIcon,
  EyeIcon,
  OpenIcon,
  StarredIcon,
  ThumbsUpIcon,
} from "outline-icons";
import * as React from "react";
import { useHistory } from "react-router-dom";
import styled from "styled-components";
import { toError } from "@shared/utils/error";
import Empty from "~/components/Empty";
import InputSearch from "~/components/InputSearch";
import Scene from "~/components/Scene";
import ButtonSmall from "~/components/ButtonSmall";
import Tooltip from "~/components/Tooltip";
import useStores from "~/hooks/useStores";
import useCurrentUser from "~/hooks/useCurrentUser";
import { client } from "~/utils/ApiClient";
import Logger from "~/utils/Logger";
import { openInTab } from "~/utils/tabNavigation";
import {
  collectionDocuments,
  listCollections,
  type CustomDocument,
} from "./customData";
import {
  filterAndSortPapers,
  planPaperMetadataRefresh,
  parsePaperData,
  parsePaperMeta,
  selectChangedPaperDocuments,
  selectPaperViewRefreshIds,
  summarizePaperTags,
  sumViewCounts,
  type Meta,
  type Paper,
  type PaperScope,
  type PaperSort,
  type Rating,
  type ReadState,
} from "./PapersHelpers";
import {
  fulfilledRefreshEntries,
  settleWithConcurrency,
} from "./RefreshHelpers";

const PAPER = "📖";
const readKey = "outline.desktop.papers.read.v1";
const likesKey = "outline.desktop.papers.likes.v1";
const paperCacheKey = "outline.desktop.papers.snapshot.v3";
const paperViewsCacheKey = "outline.desktop.papers.views.v1";
const PAPER_CACHE_TTL = 5 * 60 * 1000;
const PAPER_SOURCE_DISCOVERY_TTL = 24 * 60 * 60 * 1000;
const PAPER_VIEW_CACHE_TTL = 6 * 60 * 60 * 1000;
const PAPER_VIEW_REFRESH_LIMIT = 24;
const PAPER_VIEW_CONCURRENCY = 4;
const PAPER_SOURCE_CONCURRENCY = 3;
const PAPER_METADATA_CONCURRENCY = 2;
const refreshingPaperScopes = new Set<string>();
const interactionPath = "论文库/interactions.json";
type InteractionData = {
  version: 1;
  papers: Record<
    string,
    Record<string, { like?: boolean; score?: number; at: string }>
  >;
};
type PaperSnapshot = {
  savedAt: number;
  papers: Paper[];
  metas: Record<string, Meta>;
  complete?: boolean;
  metadataSyncedAt?: number;
  sourceCollectionIds?: string[];
  sourcesDiscoveredAt?: number;
};
type PaperViewsCache = {
  counts: Record<string, number>;
  checkedAt: Record<string, number>;
};
type WebdavResult = {
  ok?: boolean;
  data?: { found?: boolean; content?: string };
};

const emptyMeta: Meta = {
  tags: [],
  venue: null,
  link: null,
  code: null,
  enTitle: null,
  authors: null,
  org: null,
  parsed: false,
};

function asWebdavResult(value: unknown): WebdavResult {
  return value && typeof value === "object" ? (value as WebdavResult) : {};
}

function readPaperSnapshot(scope: string): PaperSnapshot | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(`${paperCacheKey}.${scope}`) ?? "null"
    ) as PaperSnapshot | null;
    return parsed && Array.isArray(parsed.papers) && parsed.metas
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function writePaperSnapshot(scope: string, snapshot: PaperSnapshot): void {
  try {
    localStorage.setItem(`${paperCacheKey}.${scope}`, JSON.stringify(snapshot));
  } catch {
    // A storage quota miss only disables the optimization; it must not block
    // the library itself.
  }
}

function readPaperViews(scope: string): PaperViewsCache {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(`${paperViewsCacheKey}.${scope}`) ?? "null"
    ) as PaperViewsCache | null;
    return parsed?.counts && parsed?.checkedAt
      ? parsed
      : { counts: {}, checkedAt: {} };
  } catch {
    return { counts: {}, checkedAt: {} };
  }
}

function writePaperViews(scope: string, cache: PaperViewsCache): void {
  try {
    localStorage.setItem(
      `${paperViewsCacheKey}.${scope}`,
      JSON.stringify(cache)
    );
  } catch {
    // Reading the library must still work when browser storage is full.
  }
}

function flatten(tree: CustomDocument[]): CustomDocument[] {
  const result: CustomDocument[] = [];
  const pending = [...tree];
  while (pending.length) {
    const item = pending.shift()!;
    result.push(item);
    pending.unshift(...(item.children ?? []));
  }
  return result;
}

function collectRecommendation(
  nodes: CustomDocument[],
  year: number | null = null,
  month: number | null = null
): Paper[] {
  return nodes.flatMap((node) => {
    const title = node.title.trim();
    const y = /^(\d{4})\s*年/.exec(title);
    const m = /^(\d{1,2})\s*月/.exec(title);
    if (y) {
      return collectRecommendation(node.children ?? [], Number(y[1]), month);
    }
    if (m) {
      return collectRecommendation(node.children ?? [], year, Number(m[1]));
    }
    return [{ ...node, children: undefined, year, month }];
  });
}

function collectFeatured(
  nodes: CustomDocument[],
  topic: string | null = null,
  source = "featured"
): Paper[] {
  return nodes.flatMap((node) => {
    const title = node.title.trim();
    if (title.startsWith(PAPER)) {
      return [
        { ...node, children: undefined, title, topic, source } as Paper,
        ...collectFeatured(node.children ?? [], topic, source),
      ];
    }
    return collectFeatured(node.children ?? [], topic ?? title, source);
  });
}

function readMap(key: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    return {};
  }
}

export default function Papers() {
  const { documents, tabs, auth } = useStores();
  const user = useCurrentUser({ rejectOnEmpty: false });
  const history = useHistory();
  const paperScope = auth.currentTeamId ?? window.location.host;
  const initialSnapshot = React.useMemo(
    () => readPaperSnapshot(paperScope),
    [paperScope]
  );
  const [papers, setPapers] = React.useState<Paper[]>(
    () => initialSnapshot?.papers ?? []
  );
  const [metas, setMetas] = React.useState<Record<string, Meta>>(
    () => initialSnapshot?.metas ?? {}
  );
  const [loading, setLoading] = React.useState(() => !initialSnapshot);
  const [metadataLoading, setMetadataLoading] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [scope, setScope] = React.useState<PaperScope>("all");
  const [year, setYear] = React.useState<number | null>(null);
  const [month, setMonth] = React.useState<number | null>(null);
  const [readFilter, setReadFilter] = React.useState<ReadState | "">("");
  const [sort, setSort] = React.useState<PaperSort>("updated");
  const [tag, setTag] = React.useState<string | null>(null);
  const scopedReadKey = `${readKey}.${paperScope}`;
  const scopedLikesKey = `${likesKey}.${paperScope}`;
  const [read, setRead] = React.useState(readMap(scopedReadKey));
  const [likes, setLikes] = React.useState(readMap(scopedLikesKey));
  const [likeCounts, setLikeCounts] = React.useState<Record<string, number>>(
    {}
  );
  const [ratings, setRatings] = React.useState<Record<string, Rating>>({});
  const [viewCounts, setViewCounts] = React.useState<Record<string, number>>(
    () => readPaperViews(paperScope).counts
  );
  const [viewed, setViewed] = React.useState<Record<string, string>>(() =>
    readMap(`${readKey}.history.${auth.currentTeamId ?? window.location.host}`)
  );

  React.useEffect(() => {
    let cancelled = false;
    window.DesktopBridge?.webdavGet(interactionPath)
      .then((value) => {
        const result = asWebdavResult(value);
        if (cancelled || !result?.ok || !result.data?.found) {
          return;
        }
        try {
          const remote = JSON.parse(
            result.data.content ?? "{}"
          ) as InteractionData;
          const next = Object.fromEntries(
            Object.entries(remote.papers ?? {}).map(([id, entries]) => [
              id,
              entries[user?.id ?? ""]?.like ? "1" : "",
            ])
          );
          const nextRatings = Object.fromEntries(
            Object.entries(remote.papers ?? {}).flatMap(([id, entries]) => {
              const scores = Object.values(entries)
                .map((entry) => entry.score)
                .filter((score): score is number => typeof score === "number");
              return scores.length
                ? [
                    [
                      id,
                      {
                        average:
                          scores.reduce((sum, score) => sum + score, 0) /
                          scores.length,
                        count: scores.length,
                        mine: entries[user?.id ?? ""]?.score ?? null,
                      } as Rating,
                    ],
                  ]
                : [];
            })
          );
          setLikes(next);
          setLikeCounts(
            Object.fromEntries(
              Object.entries(remote.papers ?? {}).map(([id, entries]) => [
                id,
                Object.values(entries).filter((entry) => entry.like).length,
              ])
            )
          );
          setRatings(nextRatings);
          localStorage.setItem(scopedLikesKey, JSON.stringify(next));
        } catch {
          /* malformed shared data falls back to local cache */
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scopedLikesKey, user?.id]);

  React.useEffect(() => {
    if (!papers.length) {
      return;
    }
    let cancelled = false;
    const cache = readPaperViews(paperScope);
    setViewCounts(cache.counts);
    const timer = window.setTimeout(() => {
      void (async () => {
        const ids = selectPaperViewRefreshIds(
          papers,
          cache.checkedAt,
          Date.now(),
          PAPER_VIEW_CACHE_TTL,
          PAPER_VIEW_REFRESH_LIMIT
        );
        for (
          let offset = 0;
          offset < ids.length;
          offset += PAPER_VIEW_CONCURRENCY
        ) {
          const batchIds = ids.slice(offset, offset + PAPER_VIEW_CONCURRENCY);
          const results = await Promise.allSettled(
            batchIds.map(async (id) => {
              const response = await client.post<{
                data: { count?: number }[];
              }>("/views.list", { documentId: id });
              return [id, sumViewCounts(response.data ?? [])] as const;
            })
          );
          const checkedAt = Date.now();
          for (const [id, count] of fulfilledRefreshEntries(results)) {
            cache.counts[id] = count;
            cache.checkedAt[id] = checkedAt;
          }
          writePaperViews(paperScope, cache);
          if (!cancelled) {
            setViewCounts({ ...cache.counts });
          }
        }
      })();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [paperScope, papers]);

  React.useEffect(() => {
    const cached = readPaperSnapshot(paperScope);
    if (cached) {
      setPapers(cached.papers);
      setMetas(cached.metas);
      setLoading(false);
      if (
        refreshKey === 0 &&
        cached.complete &&
        Date.now() - cached.savedAt < PAPER_CACHE_TTL
      ) {
        return;
      }
    } else {
      setLoading(true);
    }
    // A route change should not start a second full metadata crawl while the
    // first one is already writing the same workspace snapshot.
    if (refreshingPaperScopes.has(paperScope)) {
      return;
    }
    refreshingPaperScopes.add(paperScope);
    setMetadataLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        const syncStartedAt = Date.now();
        const collections = await listCollections();
        const knownSourceIds = new Set(cached?.sourceCollectionIds ?? []);
        const discoverSources =
          knownSourceIds.size === 0 ||
          !cached?.sourcesDiscoveredAt ||
          syncStartedAt - cached.sourcesDiscoveredAt >=
            PAPER_SOURCE_DISCOVERY_TTL;
        const sourceCollections = discoverSources
          ? collections
          : collections.filter(
              (collection) =>
                knownSourceIds.has(collection.id) ||
                ["组内工作", "精选专题"].includes(collection.name.trim())
            );
        const treeResults = await settleWithConcurrency(
          sourceCollections,
          PAPER_SOURCE_CONCURRENCY,
          async (collection) => ({
            collection,
            tree: await collectionDocuments(collection.id),
          })
        );
        const failedTree = treeResults.find(
          (result) => result.status === "rejected"
        );
        if (failedTree?.status === "rejected") {
          throw failedTree.reason;
        }
        const trees = treeResults.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : []
        );
        const found: Paper[] = [];
        const scanCollectionIds = new Set<string>();
        for (const { collection, tree } of trees) {
          const root = flatten(tree).find(
            (item) => item.title.trim() === "推荐阅读"
          );
          if (root) {
            scanCollectionIds.add(collection.id);
            found.push(...collectRecommendation(root.children ?? []));
          }
          if (collection.name.trim() === "组内工作") {
            scanCollectionIds.add(collection.id);
            found.push(
              ...flatten(tree)
                .filter((item) => item.title.trim().startsWith(PAPER))
                .map(
                  (item) =>
                    ({
                      ...item,
                      children: undefined,
                      topic: "组内工作",
                      source: "internal",
                    }) as Paper
                )
            );
          }
          if (collection.name.trim() === "精选专题") {
            scanCollectionIds.add(collection.id);
            found.push(...collectFeatured(tree));
          }
        }
        const indexed = [
          ...new Map(found.map((item) => [item.id, item])).values(),
        ];
        const cachedPapers = new Map(
          (cached?.papers ?? []).map((paper) => [paper.id, paper])
        );
        const unique = indexed.map((paper) => ({
          ...cachedPapers.get(paper.id),
          ...paper,
          children: undefined,
        }));
        // The tree contains enough information to paint the library. Show it
        // immediately, then hydrate expensive per-document metadata in small
        // batches so a cold cache never blocks the first screen.
        if (!cancelled) {
          setPapers(unique);
          setLoading(false);
        }
        // Persist the usable index before fetching any document body. This is
        // the critical cache boundary: closing the page while metadata is
        // still hydrating must not force another full collection scan.
        writePaperSnapshot(paperScope, {
          savedAt: syncStartedAt,
          papers: unique,
          metas: cached?.metas ?? {},
          complete: cached?.complete,
          metadataSyncedAt: cached?.metadataSyncedAt,
          sourceCollectionIds: [...scanCollectionIds],
          sourcesDiscoveredAt: discoverSources
            ? syncStartedAt
            : cached?.sourcesDiscoveredAt,
        });
        const paperIds = new Set(unique.map((item) => item.id));
        const paperById = new Map(unique.map((paper) => [paper.id, paper]));
        const nextMetas = Object.fromEntries(
          unique.flatMap((paper) =>
            cached?.metas[paper.id] ? [[paper.id, cached.metas[paper.id]]] : []
          )
        ) as Record<string, Meta>;
        const refreshPlan = planPaperMetadataRefresh(cached);
        const scanCollection = async (collectionId: string) => {
          const pageSize = refreshPlan.mode === "changed" ? 20 : 100;
          for (let offset = 0; offset < 5000; offset += pageSize) {
            const response = await client.post<{
              data: CustomDocument[];
              pagination?: { total?: number };
            }>("/documents.list", {
              collectionId,
              sort: "updatedAt",
              direction: "DESC",
              limit: pageSize,
              offset,
            });
            const page = response.data ?? [];
            const selected =
              refreshPlan.mode === "changed"
                ? selectChangedPaperDocuments(page, refreshPlan.since)
                : { changed: page, reachedCheckpoint: false };
            for (const document of selected.changed) {
              if (paperIds.has(document.id)) {
                Object.assign(paperById.get(document.id)!, document, {
                  children: undefined,
                });
                nextMetas[document.id] =
                  typeof document.text === "string"
                    ? parsePaperMeta(document.text)
                    : parsePaperData(document.data);
              }
            }
            if (
              selected.reachedCheckpoint ||
              page.length < pageSize ||
              (response.pagination?.total !== undefined &&
                offset + page.length >= response.pagination.total)
            ) {
              break;
            }
          }
          const progressMetas = { ...nextMetas };
          if (!cancelled) {
            setMetas(progressMetas);
          }
          writePaperSnapshot(paperScope, {
            savedAt: syncStartedAt,
            papers: unique,
            metas: progressMetas,
            complete: refreshPlan.mode === "changed" ? cached?.complete : false,
            metadataSyncedAt: cached?.metadataSyncedAt,
            sourceCollectionIds: [...scanCollectionIds],
            sourcesDiscoveredAt: discoverSources
              ? syncStartedAt
              : cached?.sourcesDiscoveredAt,
          });
        };
        const scanResults = await settleWithConcurrency(
          [...scanCollectionIds],
          PAPER_METADATA_CONCURRENCY,
          scanCollection
        );
        for (const paper of unique) {
          nextMetas[paper.id] ??= emptyMeta;
        }
        const complete = scanResults.every(
          (result) => result.status === "fulfilled"
        );
        writePaperSnapshot(paperScope, {
          savedAt: Date.now(),
          papers: unique,
          metas: nextMetas,
          complete:
            refreshPlan.mode === "changed"
              ? Boolean(cached?.complete)
              : complete,
          metadataSyncedAt: complete ? syncStartedAt : cached?.metadataSyncedAt,
          sourceCollectionIds: [...scanCollectionIds],
          sourcesDiscoveredAt: discoverSources
            ? syncStartedAt
            : cached?.sourcesDiscoveredAt,
        });
        if (!cancelled) {
          setPapers([...unique]);
          setMetas(nextMetas);
        }
      } catch (error) {
        Logger.error("Failed to load papers", toError(error));
      } finally {
        refreshingPaperScopes.delete(paperScope);
        if (!cancelled) {
          setLoading(false);
          setMetadataLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paperScope, refreshKey]);

  const tagCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const meta of Object.values(metas)) {
      for (const item of meta.tags) {
        counts.set(item, (counts.get(item) ?? 0) + 1);
      }
    }
    return counts;
  }, [metas]);
  const allTags = React.useMemo(
    () =>
      [...tagCounts]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
        .slice(0, 24)
        .map(([item]) => item),
    [tagCounts]
  );
  const years = React.useMemo(
    () =>
      [
        ...new Set(papers.flatMap((paper) => (paper.year ? [paper.year] : []))),
      ].sort((a, b) => b - a),
    [papers]
  );
  const months = React.useMemo(
    () =>
      [
        ...new Set(
          papers.flatMap((paper) =>
            paper.month && (!year || paper.year === year) ? [paper.month] : []
          )
        ),
      ].sort((a, b) => b - a),
    [papers, year]
  );
  const visible = React.useMemo(
    () =>
      filterAndSortPapers({
        papers,
        metas,
        read,
        likes,
        viewed,
        viewCounts,
        ratings,
        options: { query, tag, year, month, readFilter, scope, sort },
      }),
    [
      papers,
      metas,
      read,
      likes,
      viewed,
      viewCounts,
      ratings,
      query,
      tag,
      year,
      month,
      readFilter,
      scope,
      sort,
    ]
  );

  const cycleRead = (id: string) => {
    const next = {
      ...read,
      [id]:
        read[id] === "unread"
          ? "reading"
          : read[id] === "reading"
            ? "read"
            : "unread",
    };
    setRead(next);
    localStorage.setItem(scopedReadKey, JSON.stringify(next));
  };
  const toggleLike = (id: string) => {
    if (!user) {
      return;
    }
    const next = { ...likes };
    const liked = !next[id];
    if (liked) {
      next[id] = "1";
    } else {
      delete next[id];
    }
    setLikes(next);
    setLikeCounts((current) => ({
      ...current,
      [id]: Math.max(0, (current[id] ?? 0) + (liked ? 1 : -1)),
    }));
    localStorage.setItem(scopedLikesKey, JSON.stringify(next));
    void (async () => {
      try {
        const currentResult = asWebdavResult(
          await window.DesktopBridge?.webdavGet(interactionPath)
        );
        const current: InteractionData = currentResult?.data?.found
          ? JSON.parse(currentResult.data.content ?? "{}")
          : { version: 1, papers: {} };
        const paper = { ...current.papers[id] };
        if (liked) {
          paper[user.id] = {
            ...paper[user.id],
            like: true,
            at: new Date().toISOString(),
          };
        } else {
          const entry = { ...paper[user.id] };
          delete entry.like;
          if (entry.at) {
            paper[user.id] = entry;
          } else {
            delete paper[user.id];
          }
        }
        if (Object.keys(paper).length) {
          current.papers[id] = paper;
        } else {
          delete current.papers[id];
        }
        await window.DesktopBridge?.webdavPut(
          interactionPath,
          JSON.stringify(current, null, 2)
        );
      } catch (error) {
        Logger.error("Failed to save paper like", toError(error));
      }
    })();
  };
  const setScore = (id: string) => {
    if (!user) {
      return;
    }
    const current = ratings[id]?.mine ?? 0;
    const score = current >= 5 ? null : current + 1;
    setRatings((previous) => ({
      ...previous,
      [id]: { average: score ?? 0, count: score ? 1 : 0, mine: score },
    }));
    void (async () => {
      try {
        const result = asWebdavResult(
          await window.DesktopBridge?.webdavGet(interactionPath)
        );
        const data: InteractionData = result?.data?.found
          ? JSON.parse(result.data.content ?? "{}")
          : { version: 1, papers: {} };
        const paper = { ...data.papers[id] };
        const entry = {
          ...paper[user.id],
          at: new Date().toISOString(),
        };
        if (score) {
          entry.score = score;
        } else {
          delete entry.score;
        }
        if (entry.like || entry.score) {
          paper[user.id] = entry;
        } else {
          delete paper[user.id];
        }
        if (Object.keys(paper).length) {
          data.papers[id] = paper;
        } else {
          delete data.papers[id];
        }
        await window.DesktopBridge?.webdavPut(
          interactionPath,
          JSON.stringify(data, null, 2)
        );
      } catch (error) {
        Logger.error("Failed to save paper score", toError(error));
      }
    })();
  };
  const open = (paper: Paper) => {
    const nextViewed = { ...viewed, [paper.id]: new Date().toISOString() };
    setViewed(nextViewed);
    localStorage.setItem(
      `${readKey}.history.${auth.currentTeamId ?? window.location.host}`,
      JSON.stringify(nextViewed)
    );
    setViewCounts((current) => ({
      ...current,
      [paper.id]: (current[paper.id] ?? 0) + 1,
    }));
    void client
      .post("/views.create", { documentId: paper.id })
      .catch(() => undefined);
    openInTab(history, tabs, {
      id: paper.id,
      url: documents.get(paper.id)?.url ?? `/doc/${paper.id}`,
      title: paper.title.replace(/^📖\s*/, ""),
      emoji: paper.emoji,
    });
  };

  return (
    <Scene
      icon={<AcademicCapIcon />}
      title="论文库"
      textTitle="论文库"
      wide
      hideHeaderOnDesktop
    >
      <Board>
        <FeatureHeader>
          <HeaderCopy>
            <PageHeading>论文库</PageHeading>
            <FeatureHint>
              推荐阅读目录的检索视图，按时间、领域、状态和关键词快速定位。
            </FeatureHint>
          </HeaderCopy>
          <HeaderSide>
            <FeatureStats>
              {papers.length ? `共 ${papers.length} 篇` : "准备索引中"}
              {metadataLoading && papers.length > 0 ? " · 更新中" : ""}
            </FeatureStats>
            <ButtonSmall
              neutral
              onClick={() => setRefreshKey((current) => current + 1)}
              aria-label="刷新论文库"
              disabled={metadataLoading}
            >
              {metadataLoading ? "刷新中…" : "刷新"}
            </ButtonSmall>
          </HeaderSide>
        </FeatureHeader>
        <ScopeBar role="tablist" aria-label="论文范围">
          {(["all", "liked", "history"] as PaperScope[]).map((item) => (
            <ScopeButton
              key={item}
              type="button"
              role="tab"
              aria-selected={scope === item}
              $active={scope === item}
              onClick={() => setScope(item)}
            >
              {item === "all"
                ? `全部 ${papers.length}`
                : item === "liked"
                  ? `我赞过 ${Object.keys(likes).length}`
                  : `最近浏览 ${Object.keys(viewed).length}`}
            </ScopeButton>
          ))}
        </ScopeBar>
        <Toolbar>
          <SearchBox>
            <InputSearch
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、作者、领域或会议…"
            />
          </SearchBox>
          <FilterLabel>
            <FilterName>年份</FilterName>
            <select
              aria-label="推荐年份"
              value={year ?? ""}
              onChange={(event) => {
                setYear(event.target.value ? Number(event.target.value) : null);
                setMonth(null);
              }}
            >
              <option value="">全部年份</option>
              {years.map((item) => (
                <option key={item} value={item}>
                  {item} 年
                </option>
              ))}
            </select>
          </FilterLabel>
          <FilterLabel>
            <FilterName>月份</FilterName>
            <select
              aria-label="推荐月份"
              value={month ?? ""}
              onChange={(event) =>
                setMonth(event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">全部月份</option>
              {months.map((item) => (
                <option key={item} value={item}>
                  {item} 月
                </option>
              ))}
            </select>
          </FilterLabel>
          <FilterLabel>
            <FilterName>状态</FilterName>
            <select
              aria-label="阅读状态"
              value={readFilter}
              onChange={(event) =>
                setReadFilter(event.target.value as ReadState | "")
              }
            >
              <option value="">全部状态</option>
              <option value="unread">未读</option>
              <option value="reading">在读</option>
              <option value="read">已读</option>
            </select>
          </FilterLabel>
          <FilterLabel>
            <FilterName>排序</FilterName>
            <select
              aria-label="论文排序"
              value={sort}
              onChange={(event) => setSort(event.target.value as PaperSort)}
            >
              <option value="updated">更新时间 新→旧</option>
              <option value="views">阅读量 多→少</option>
              <option value="likes">点赞优先</option>
              <option value="score">评分优先</option>
              <option value="title">标题 A→Z</option>
            </select>
          </FilterLabel>
        </Toolbar>
        <FilterSummary aria-label="当前论文筛选">
          {tag && (
            <ActiveFilter>
              标签：{tag}
              <button
                type="button"
                onClick={() => setTag(null)}
                aria-label="清除标签筛选"
              >
                ×
              </button>
            </ActiveFilter>
          )}
        </FilterSummary>
        {allTags.length > 0 && (
          <TagBar aria-label="热门领域标签">
            <TagHeading>热门领域</TagHeading>
            {allTags.map((item) => (
              <Tag
                type="button"
                key={item}
                $active={tag === item}
                onClick={() => setTag(tag === item ? null : item)}
              >
                {item} <TagCount>{tagCounts.get(item)}</TagCount>
              </Tag>
            ))}
          </TagBar>
        )}
        {(query.trim() ||
          tag ||
          year ||
          month ||
          readFilter ||
          scope !== "all") && (
          <Summary>
            <strong>{visible.length}</strong> 篇匹配 · 已读{" "}
            {Object.values(read).filter((value) => value === "read").length} 篇
            {scope === "history" && <span> · 按最近浏览排序</span>}
          </Summary>
        )}
        {loading ? (
          <Empty>正在加载论文库…</Empty>
        ) : visible.length === 0 ? (
          <Empty>没有匹配的论文。可以清除筛选条件后再试。</Empty>
        ) : (
          <List>
            {visible.map((paper) => {
              const meta = metas[paper.id] ?? emptyMeta;
              const tagSummary = summarizePaperTags(meta.tags ?? [], 4);
              const state = read[paper.id] ?? "unread";
              const source =
                paper.source === "internal"
                  ? "组内工作"
                  : paper.source === "featured"
                    ? (paper.topic ?? "精选专题")
                    : paper.year
                      ? `${paper.year} · ${paper.month ?? "?"}月`
                      : null;
              return (
                <Row
                  key={paper.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => open(paper)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      open(paper);
                    }
                  }}
                >
                  <Main>
                    <Title title={paper.title.replace(/^📖\s*/, "")}>
                      {paper.title.replace(/^📖\s*/, "")}
                    </Title>
                    {meta.enTitle && (
                      <EnglishTitle title={meta.enTitle}>
                        {meta.enTitle}
                      </EnglishTitle>
                    )}
                    {(meta.authors || meta.org) && (
                      <AuthorLine>
                        {meta.authors && <span>{meta.authors}</span>}
                        {meta.authors && meta.org && <Separator>·</Separator>}
                        {meta.org && <Organization>{meta.org}</Organization>}
                      </AuthorLine>
                    )}
                    <MetaLine>
                      {source && <MetaPill>{source}</MetaPill>}
                      {meta.venue && <span>{meta.venue}</span>}
                      {(viewCounts[paper.id] ?? 0) > 0 && (
                        <span>
                          <EyeIcon size={13} /> {viewCounts[paper.id]} 人读过
                        </span>
                      )}
                      {tagSummary.visible.map((item) => (
                        <Tag
                          type="button"
                          key={item}
                          onClick={(event) => {
                            event.stopPropagation();
                            setTag(item);
                          }}
                        >
                          {item}
                        </Tag>
                      ))}
                      {tagSummary.hiddenCount > 0 && (
                        <OverflowTag title={meta.tags.join("、")}>
                          +{tagSummary.hiddenCount}
                        </OverflowTag>
                      )}
                    </MetaLine>
                  </Main>
                  <Actions>
                    <Tooltip
                      content={likes[paper.id] ? "取消点赞" : "点赞"}
                      placement="bottom"
                    >
                      <IconButton
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleLike(paper.id);
                        }}
                        $active={!!likes[paper.id]}
                        aria-label={likes[paper.id] ? "取消点赞" : "点赞"}
                      >
                        <ThumbsUpIcon size={15} />
                        {(likeCounts[paper.id] ?? 0) > 0 && (
                          <Count>{likeCounts[paper.id]}</Count>
                        )}
                      </IconButton>
                    </Tooltip>
                    <Tooltip
                      content="点击循环评分，5 星后清除"
                      placement="bottom"
                    >
                      <IconButton
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setScore(paper.id);
                        }}
                        $active={!!ratings[paper.id]?.mine}
                        aria-label={`评分 ${ratings[paper.id]?.average?.toFixed(1) ?? "未评分"}`}
                      >
                        <StarredIcon size={15} />
                        {ratings[paper.id]?.average ? (
                          <Count>{ratings[paper.id].average.toFixed(1)}</Count>
                        ) : null}
                      </IconButton>
                    </Tooltip>
                    {meta.link && (
                      <Tooltip content="打开论文原文" placement="bottom">
                        <IconLink
                          href={meta.link}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          aria-label="打开论文原文"
                        >
                          <OpenIcon size={15} />
                        </IconLink>
                      </Tooltip>
                    )}
                    {meta.code && (
                      <Tooltip content="打开代码仓库" placement="bottom">
                        <IconLink
                          href={meta.code}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          aria-label="打开代码仓库"
                        >
                          <CodeIcon size={15} />
                        </IconLink>
                      </Tooltip>
                    )}
                    <ReadButton
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        cycleRead(paper.id);
                      }}
                      $state={state}
                      aria-label={`阅读状态：${state === "read" ? "已读" : state === "reading" ? "在读" : "未读"}`}
                    >
                      <ReadDot $state={state} />
                      <ReadText>
                        {state === "read"
                          ? "已读"
                          : state === "reading"
                            ? "在读"
                            : "未读"}
                      </ReadText>
                    </ReadButton>
                  </Actions>
                </Row>
              );
            })}
          </List>
        )}
      </Board>
    </Scene>
  );
}

const Board = styled.div`
  width: min(100%, 1280px);
  margin: 0 auto;
  padding: 22px 28px 56px;

  @media (max-width: 700px) {
    padding: 12px 16px 40px;
  }
`;
const Toolbar = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 10px 0 12px;
  padding: 10px;
  border: 1px solid ${(p) => p.theme.divider};
  border-radius: 10px;
  background: ${(p) => p.theme.background};
  flex-wrap: wrap;

  @media (max-width: 700px) {
    flex-direction: column;
    align-items: stretch;
  }
`;
const FeatureHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin: 8px 0 20px;

  @media (max-width: 860px) {
    align-items: flex-start;
    flex-direction: column;
  }
`;
const HeaderCopy = styled.div`
  min-width: 0;
`;
const PageHeading = styled.h1`
  margin: 0 0 5px;
  color: ${(props) => props.theme.text};
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.2;
`;
const FeatureHint = styled.p`
  margin: 0;
  max-width: 720px;
  color: ${(props) => props.theme.textTertiary};
  font-size: 14px;
  line-height: 1.5;
`;
const HeaderSide = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
  flex-shrink: 0;

  @media (max-width: 860px) {
    width: 100%;
    justify-content: space-between;
  }
`;
const FeatureStats = styled.div`
  flex-shrink: 0;
  padding: 5px 9px;
  border-radius: 7px;
  color: ${(props) => props.theme.textTertiary};
  background: ${(props) => props.theme.backgroundSecondary};
  font-size: 13px;
`;
const ScopeBar = styled.div`
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  padding-bottom: 2px;
`;
const ScopeButton = styled.button<{ $active: boolean }>`
  border: 1px solid ${(p) => (p.$active ? p.theme.accent : p.theme.divider)};
  border-radius: 999px;
  padding: 5px 11px;
  color: ${(p) => (p.$active ? p.theme.accent : p.theme.textSecondary)};
  background: ${(p) =>
    p.$active ? p.theme.backgroundSecondary : p.theme.background};
  font-size: 13px;
  cursor: pointer;
  &:hover {
    color: ${(p) => p.theme.text};
    background: ${(p) => p.theme.backgroundSecondary};
  }
  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.inputBorderFocused};
    outline-offset: -1px;
  }
`;
const SearchBox = styled.div`
  flex: 1;
  min-width: 220px;
`;
const FilterLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  color: ${(p) => p.theme.textTertiary};
  font-size: 12px;
  select {
    height: 34px;
    border: 1px solid ${(p) => p.theme.divider};
    border-radius: 7px;
    padding: 0 9px;
    color: ${(p) => p.theme.text};
    background: ${(p) => p.theme.backgroundSecondary};
    font: inherit;
    cursor: pointer;
  }
`;
const FilterName = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
`;
const FilterSummary = styled.div`
  min-height: 0;
  margin-bottom: 8px;
`;
const TagBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-bottom: 12px;
  padding: 0 0 12px;
  border-bottom: 1px solid ${(p) => p.theme.divider};
`;
const TagHeading = styled.span`
  color: ${(p) => p.theme.textTertiary};
  font-size: 12px;
  margin-right: 2px;
`;
const Tag = styled.button<{ $active?: boolean }>`
  border: 1px solid ${(p) => (p.$active ? p.theme.accent : p.theme.divider)};
  border-radius: 999px;
  padding: 3px 8px;
  color: ${(p) => (p.$active ? p.theme.accent : p.theme.textSecondary)};
  background: ${(p) =>
    p.$active ? p.theme.backgroundSecondary : p.theme.background};
  cursor: pointer;
  font-size: 12px;
  &:hover {
    color: ${(p) => p.theme.text};
    background: ${(p) => p.theme.backgroundSecondary};
  }
  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.inputBorderFocused};
    outline-offset: 1px;
  }
`;
const TagCount = styled.span`
  margin-left: 2px;
  color: ${(p) => p.theme.textTertiary};
  font-size: 10px;
  opacity: 0.75;
`;
const Summary = styled.div`
  color: ${(p) => p.theme.textTertiary};
  font-size: 13px;
  margin: 10px 0 6px;
  strong {
    color: ${(p) => p.theme.text};
    font-weight: 600;
  }
`;
const List = styled.div`
  display: flex;
  flex-direction: column;
  border-top: 1px solid ${(p) => p.theme.divider};
`;
const Row = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 18px;
  padding: 16px 10px;
  border-bottom: 1px solid ${(p) => p.theme.divider};
  border-radius: 5px;
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease;
  &:hover {
    background: ${(p) => p.theme.backgroundSecondary};
  }
  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.inputBorderFocused};
    outline-offset: -2px;
  }
`;
const Main = styled.div`
  min-width: 0;
  flex: 1;
`;
const Title = styled.div`
  display: -webkit-box;
  overflow: hidden;
  color: ${(p) => p.theme.text};
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
`;
const MetaLine = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  color: ${(p) => p.theme.textTertiary};
  font-size: 12px;
  margin-top: 7px;
  svg {
    vertical-align: -2px;
  }
`;
const MetaPill = styled.span`
  padding: 1px 6px;
  border-radius: 4px;
  color: ${(p) => p.theme.textSecondary};
  background: ${(p) => p.theme.backgroundSecondary};
`;
const EnglishTitle = styled.div`
  overflow: hidden;
  margin-top: 4px;
  color: ${(p) => p.theme.textSecondary};
  font-size: 13px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
const AuthorLine = styled.div`
  display: flex;
  gap: 5px;
  align-items: center;
  min-width: 0;
  margin-top: 6px;
  overflow: hidden;
  color: ${(p) => p.theme.textTertiary};
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;

  > span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;
const Organization = styled.span`
  overflow: hidden;
  color: ${(p) => p.theme.textTertiary};
  text-overflow: ellipsis;
`;
const Separator = styled.span`
  flex-shrink: 0;
`;
const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  align-self: center;

  ${Row}:not(:hover) & button:not([aria-pressed="true"]),
  ${Row}:not(:hover) & a {
    opacity: 0.72;
  }
`;
const IconButton = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 28px;
  height: 28px;
  padding: 0 5px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: ${(p) => (p.$active ? p.theme.accent : p.theme.textTertiary)};
  cursor: pointer;
  &:hover {
    color: ${(p) => p.theme.text};
    background: ${(p) => p.theme.backgroundTertiary};
  }
  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.inputBorderFocused};
    outline-offset: -1px;
  }
`;
const IconLink = styled.a`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 5px;
  color: ${(p) => p.theme.textTertiary};
  cursor: pointer;
  &:hover {
    color: ${(p) => p.theme.text};
    background: ${(p) => p.theme.backgroundTertiary};
  }
  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.inputBorderFocused};
    outline-offset: -1px;
  }
`;
const Count = styled.span`
  font-size: 11px;
`;
const ReadButton = styled.button<{ $state: string }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid
    ${(p) => (p.$state === "read" ? p.theme.success : p.theme.divider)};
  color: ${(p) =>
    p.$state === "read" ? p.theme.success : p.theme.textTertiary};
  background: transparent;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 12px;
  &:hover {
    background: ${(p) => p.theme.backgroundTertiary};
  }
  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.inputBorderFocused};
    outline-offset: 1px;
  }
`;
const ReadDot = styled.span<{ $state: string }>`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${(p) =>
    p.$state === "read"
      ? p.theme.success
      : p.$state === "reading"
        ? p.theme.warning
        : p.theme.textTertiary};
`;
const ActiveFilter = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border-radius: 6px;
  color: ${(p) => p.theme.accent};
  background: ${(p) => p.theme.backgroundSecondary};
  font-size: 12px;
  button {
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
  }
`;
const OverflowTag = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 7px;
  border: 1px solid ${(p) => p.theme.divider};
  border-radius: 999px;
  color: ${(p) => p.theme.textTertiary};
  background: ${(p) => p.theme.background};
  font-size: 11px;
`;
const ReadText = styled.span`
  @media (max-width: 760px) {
    display: none;
  }
`;
