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
  type Meta,
  type Paper,
  type PaperScope,
  type PaperSort,
  type Rating,
  type ReadState,
} from "./PapersHelpers";

const PAPER = "📖";
const readKey = "outline.desktop.papers.read.v1";
const likesKey = "outline.desktop.papers.likes.v1";
const paperCacheKey = "outline.desktop.papers.snapshot.v1";
const PAPER_CACHE_TTL = 30 * 60 * 1000;
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
};
type WebdavResult = {
  ok?: boolean;
  data?: { found?: boolean; content?: string };
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
    return [{ ...node, year, month }];
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
        { ...node, title, topic, source } as Paper,
        ...collectFeatured(node.children ?? [], topic, source),
      ];
    }
    return collectFeatured(node.children ?? [], topic ?? title, source);
  });
}

function parseMeta(text: string | undefined): Meta {
  const fields = new Map<string, string>();
  for (const line of (text ?? "").split("\n").slice(0, 45)) {
    const match = /^\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/.exec(line.trim());
    if (match && !/^[-\s:]+$/.test(match[1])) {
      fields.set(match[1].trim(), match[2].trim());
    }
  }
  const pick = (...keys: string[]) =>
    [...fields].find(([name]) => keys.some((key) => name.includes(key)))?.[1] ??
    null;
  const extractUrl = (value: string | null) =>
    value
      ? (/\((https?:\/\/[^)]+)\)/.exec(value)?.[1] ??
        (value.startsWith("http") ? value : null))
      : null;
  const title = pick(
    "英文标题",
    "原文标题",
    "原标题",
    "英文题目",
    "论文标题",
    "Title"
  );
  return {
    tags: (pick("领域", "方向", "标签") ?? "")
      .split(/[,，、;；|]/)
      .map((tag) => tag.replace(/[*_`]/g, "").trim())
      .filter(Boolean),
    venue: pick("发表时间", "发表", "venue"),
    link: extractUrl(pick("论文链接", "链接")),
    code: extractUrl(pick("代码仓库", "代码", "源码", "GitHub")),
    enTitle:
      title
        ?.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[*_`]/g, "")
        .trim() || null,
  };
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
  const [papers, setPapers] = React.useState<Paper[]>(
    () => readPaperSnapshot(paperScope)?.papers ?? []
  );
  const [metas, setMetas] = React.useState<Record<string, Meta>>(
    () => readPaperSnapshot(paperScope)?.metas ?? {}
  );
  const [loading, setLoading] = React.useState(
    () => !readPaperSnapshot(paperScope)
  );
  const [query, setQuery] = React.useState("");
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [scope, setScope] = React.useState<PaperScope>("all");
  const [readFilter, setReadFilter] = React.useState<ReadState | "">("");
  const [sort, setSort] = React.useState<PaperSort>("updated");
  const [tag, setTag] = React.useState<string | null>(null);
  const scopedReadKey = `${readKey}.${paperScope}`;
  const scopedLikesKey = `${likesKey}.${paperScope}`;
  const [read, setRead] = React.useState(readMap(scopedReadKey));
  const [likes, setLikes] = React.useState(readMap(scopedLikesKey));
  const [ratings, setRatings] = React.useState<Record<string, Rating>>({});
  const [viewCounts, setViewCounts] = React.useState<Record<string, number>>(
    {}
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
    let cancelled = false;
    void Promise.allSettled(
      papers.slice(0, 200).map(async (paper) => {
        const response = await client.post<{
          data: { views?: { count?: number }[] };
        }>("/views.list", { documentId: paper.id });
        return [
          paper.id,
          (response.data?.views ?? []).reduce(
            (total, view) => total + (view.count ?? 1),
            0
          ),
        ] as const;
      })
    ).then((results) => {
      if (!cancelled) {
        setViewCounts(
          Object.fromEntries(
            results.flatMap((result) =>
              result.status === "fulfilled" ? [result.value] : []
            )
          )
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [papers]);

  React.useEffect(() => {
    const cached = readPaperSnapshot(paperScope);
    if (cached) {
      setPapers(cached.papers);
      setMetas(cached.metas);
      setLoading(false);
      if (cached.complete && Date.now() - cached.savedAt < PAPER_CACHE_TTL) {
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
    let cancelled = false;
    void (async () => {
      try {
        const collections = await listCollections();
        const trees = await Promise.all(
          collections.map(async (collection) => ({
            collection,
            tree: await collectionDocuments(collection.id),
          }))
        );
        const found: Paper[] = [];
        for (const { collection, tree } of trees) {
          const root = flatten(tree).find(
            (item) => item.title.trim() === "推荐阅读"
          );
          if (root) {
            found.push(...collectRecommendation(root.children ?? []));
          }
          if (collection.name.trim() === "组内工作") {
            found.push(
              ...flatten(tree)
                .filter((item) => item.title.trim().startsWith(PAPER))
                .map(
                  (item) =>
                    ({
                      ...item,
                      topic: "组内工作",
                      source: "internal",
                    }) as Paper
                )
            );
          }
          if (collection.name.trim() === "精选专题") {
            found.push(...collectFeatured(tree));
          }
        }
        const search = await client.post<{ data: CustomDocument[] }>(
          "/documents.list",
          { query: "📖", sort: "updatedAt", direction: "DESC", limit: 100 }
        );
        found.push(
          ...((search.data ?? []).filter((item) =>
            item.title.trim().startsWith(PAPER)
          ) as Paper[])
        );
        const unique = [
          ...new Map(found.map((item) => [item.id, item])).values(),
        ];
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
          savedAt: Date.now(),
          papers: unique,
          metas: cached?.metas ?? {},
          complete: false,
        });
        const nextMetas: Record<string, Meta> = {};
        const concurrency = 12;
        for (let i = 0; i < unique.length; i += concurrency) {
          const batch = await Promise.all(
            unique.slice(i, i + concurrency).map(async (item) => {
              try {
                const response = await client.post<{
                  data: CustomDocument & { text?: string };
                }>("/documents.info", { id: item.id });
                return [item.id, parseMeta(response.data?.text)] as const;
              } catch {
                return [item.id, parseMeta(undefined)] as const;
              }
            })
          );
          for (const [id, meta] of batch) {
            nextMetas[id] = meta;
          }
          if (!cancelled && i % (concurrency * 4) === 0) {
            setMetas({ ...nextMetas });
          }
        }
        writePaperSnapshot(paperScope, {
          savedAt: Date.now(),
          papers: unique,
          metas: nextMetas,
          complete: true,
        });
        if (!cancelled) {
          setPapers(unique);
          setMetas(nextMetas);
        }
      } catch (error) {
        Logger.error("Failed to load papers", toError(error));
      } finally {
        refreshingPaperScopes.delete(paperScope);
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paperScope, refreshKey]);

  const allTags = React.useMemo(
    () =>
      [...new Set(Object.values(metas).flatMap((meta) => meta.tags))].slice(
        0,
        24
      ),
    [metas]
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
        options: { query, tag, readFilter, scope, sort },
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
      actions={
        <ButtonSmall
          neutral
          onClick={() => setRefreshKey((current) => current + 1)}
          aria-label="刷新论文库"
        >
          刷新
        </ButtonSmall>
      }
    >
      <FeatureHeader>
        <FeatureHint>
          汇总推荐阅读、精选专题与组内工作，按领域、状态和互动记录快速定位。
        </FeatureHint>
        <FeatureStats>
          {papers.length ? `${papers.length} 篇论文` : "准备索引中"}
        </FeatureStats>
      </FeatureHeader>
      <Toolbar>
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
                ? "全部"
                : item === "liked"
                  ? `我赞过 · ${Object.keys(likes).length}`
                  : `最近浏览 · ${Object.keys(viewed).length}`}
            </ScopeButton>
          ))}
        </ScopeBar>
        <SearchBox>
          <InputSearch
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、作者、领域或会议…"
          />
        </SearchBox>
        <FilterLabel>
          阅读状态
          <select
            value={readFilter}
            onChange={(event) =>
              setReadFilter(event.target.value as ReadState | "")
            }
          >
            <option value="">全部</option>
            <option value="unread">未读</option>
            <option value="reading">在读</option>
            <option value="read">已读</option>
          </select>
        </FilterLabel>
        <FilterLabel>
          排序
          <select
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
              {item}
            </Tag>
          ))}
        </TagBar>
      )}
      {(query.trim() || tag || readFilter || scope !== "all") && (
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
            const meta = metas[paper.id] ?? { tags: [] };
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
                <PaperIcon aria-hidden>{paper.emoji ?? "📖"}</PaperIcon>
                <Main>
                  <Title>{paper.title.replace(/^📖\s*/, "")}</Title>
                  <MetaLine>
                    {source && <MetaPill>{source}</MetaPill>}
                    {meta.venue && <span>{meta.venue}</span>}
                    <span>
                      <EyeIcon size={13} /> {viewCounts[paper.id] ?? 0}
                    </span>
                    {meta.tags?.slice(0, 4).map((item) => (
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
                  </MetaLine>
                  {meta.enTitle && <EnglishTitle>{meta.enTitle}</EnglishTitle>}
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
    </Scene>
  );
}

const Toolbar = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0 0 10px;
  padding: 8px;
  border-radius: 8px;
  background: ${(p) => p.theme.backgroundSecondary};
  flex-wrap: wrap;

  @media (max-width: 700px) {
    flex-direction: column;
    align-items: stretch;
  }
`;
const FeatureHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin: 14px 0 16px;
`;
const FeatureHint = styled.p`
  margin: 0;
  max-width: 680px;
  color: ${(props) => props.theme.textTertiary};
  font-size: 13px;
`;
const FeatureStats = styled.div`
  flex-shrink: 0;
  padding: 4px 8px;
  border-radius: 5px;
  color: ${(props) => props.theme.textTertiary};
  background: ${(props) => props.theme.backgroundSecondary};
  font-size: 13px;
`;
const ScopeBar = styled.div`
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  padding: 0;
`;
const ScopeButton = styled.button<{ $active: boolean }>`
  border: 0;
  border-radius: 6px;
  padding: 7px 9px;
  color: ${(p) => (p.$active ? p.theme.text : p.theme.textTertiary)};
  background: ${(p) => (p.$active ? p.theme.background : "transparent")};
  font-size: 13px;
  cursor: pointer;
  &:hover {
    color: ${(p) => p.theme.text};
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
  gap: 6px;
  flex-shrink: 0;
  color: ${(p) => p.theme.textTertiary};
  font-size: 12px;
  select {
    height: 30px;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0 8px;
    color: ${(p) => p.theme.text};
    background: ${(p) => p.theme.background};
    font: inherit;
    cursor: pointer;
  }
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
  margin-bottom: 8px;
  padding: 0 2px 8px;
  border-bottom: 1px solid ${(p) => p.theme.divider};
`;
const TagHeading = styled.span`
  color: ${(p) => p.theme.textTertiary};
  font-size: 12px;
  margin-right: 2px;
`;
const Tag = styled.button<{ $active?: boolean }>`
  border: 0;
  border-radius: 5px;
  padding: 4px 7px;
  color: ${(p) => (p.$active ? p.theme.accent : p.theme.textTertiary)};
  background: ${(p) =>
    p.$active ? p.theme.backgroundSecondary : "transparent"};
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
  gap: 12px;
  padding: 13px 10px;
  border-bottom: 1px solid ${(p) => p.theme.divider};
  border-radius: 5px;
  cursor: pointer;
  &:hover {
    background: ${(p) => p.theme.backgroundSecondary};
  }
  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.inputBorderFocused};
    outline-offset: -2px;
  }
`;
const PaperIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 6px;
  background: ${(p) => p.theme.backgroundSecondary};
  font-size: 16px;
`;
const Main = styled.div`
  min-width: 0;
  flex: 1;
`;
const Title = styled.div`
  color: ${(p) => p.theme.text};
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
const MetaLine = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  color: ${(p) => p.theme.textTertiary};
  font-size: 12px;
  margin-top: 4px;
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
  margin-top: 5px;
  color: ${(p) => p.theme.textTertiary};
  font-size: 12px;
  font-style: italic;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
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
const ReadText = styled.span`
  @media (max-width: 760px) {
    display: none;
  }
`;
