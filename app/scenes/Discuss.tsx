import { CommentIcon, OpenIcon, PinIcon, ThumbsUpIcon } from "outline-icons";
import * as React from "react";
import { useHistory } from "react-router-dom";
import styled from "styled-components";
import ButtonSmall from "~/components/ButtonSmall";
import Empty from "~/components/Empty";
import InputSearch from "~/components/InputSearch";
import Scene from "~/components/Scene";
import Tooltip from "~/components/Tooltip";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import { openInTab } from "~/utils/tabNavigation";
import {
  collectionDocuments,
  listCollections,
  type CustomDocument,
} from "./customData";
import { visibleTopics } from "./DiscussHelpers";

type Topic = Omit<CustomDocument, "createdBy"> & {
  parentDocumentId?: string | null;
  createdBy?: { id?: string; name?: string };
};
const likeKey = "outline.desktop.discuss.likes.v1";

function readLikes(scope: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(`${likeKey}.${scope}`) ?? "{}");
  } catch {
    return {};
  }
}

function flattenTopics(
  tree: CustomDocument[],
  parentDocumentId: string | null = null
): Topic[] {
  return tree.flatMap((document) => [
    {
      ...document,
      parentDocumentId,
    },
    ...flattenTopics(document.children ?? [], document.id),
  ]);
}

export default function Discuss() {
  const { documents, tabs, auth } = useStores();
  const history = useHistory();
  const scope = auth.currentTeamId ?? window.location.host;
  const [topics, setTopics] = React.useState<Topic[]>([]);
  const [categories, setCategories] = React.useState<CustomDocument[]>([]);
  const [forumFound, setForumFound] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [composing, setComposing] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState("");
  const [likes, setLikes] = React.useState(() => readLikes(scope));
  const [pins, setPins] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const collections = await listCollections();
      const forum = collections.find((item) =>
        ["论坛空间", "讨论区"].includes(item.name.trim())
      );
      if (!forum) {
        setForumFound(false);
        setTopics([]);
        setCategories([]);
        return;
      }
      const tree = await collectionDocuments(forum.id);
      const cats = tree.filter((item) => (item.children?.length ?? 0) > 0);
      const categoryIds = new Set(cats.map((item) => item.id));
      setForumFound(true);
      setCategories(cats);
      setTopics(
        flattenTopics(tree).filter((item) => !categoryIds.has(item.id))
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    let cancelled = false;
    void client
      .post<{ data: { pins: { id: string; documentId: string }[] } }>(
        "/pins.list",
        { limit: 100 }
      )
      .then((response) => {
        if (!cancelled) {
          setPins(
            Object.fromEntries(
              (response.data?.pins ?? []).map((pin) => [pin.documentId, pin.id])
            )
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [topics.length]);

  const createTopic = async () => {
    if (!title.trim()) {
      return;
    }
    try {
      const response = await client.post<{ data: Topic }>("/documents.create", {
        title: title.trim(),
        text: "",
        collectionId: (await listCollections()).find((item) =>
          ["论坛空间", "讨论区"].includes(item.name.trim())
        )?.id,
        ...(selectedCategory ? { parentDocumentId: selectedCategory } : {}),
        publish: true,
      });
      setComposing(false);
      setTitle("");
      await load();
      if (response.data) {
        openInTab(history, tabs, {
          id: response.data.id,
          url:
            documents.get(response.data.id)?.url ?? `/doc/${response.data.id}`,
          title: response.data.title || title.trim(),
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发帖失败");
    }
  };

  const toggleLike = (id: string) => {
    const next = { ...likes, [id]: !likes[id] };
    setLikes(next);
    localStorage.setItem(`${likeKey}.${scope}`, JSON.stringify(next));
  };

  const togglePin = async (id: string) => {
    try {
      if (pins[id]) {
        await client.post("/pins.delete", { id: pins[id] });
        setPins((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      } else {
        const response = await client.post<{ data: { id: string } }>(
          "/pins.create",
          { documentId: id }
        );
        setPins((current) => ({ ...current, [id]: response.data.id }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "置顶操作失败");
    }
  };

  const visible = visibleTopics(topics, pins, { category, query });
  const categoryNames = new Map(
    categories.map((item) => [item.id, item.title])
  );
  const openTopic = (topic: Topic) => {
    openInTab(history, tabs, {
      id: topic.id,
      url: documents.get(topic.id)?.url ?? `/doc/${topic.id}`,
      title: topic.title || "无标题",
    });
  };

  return (
    <Scene
      icon={<CommentIcon />}
      title="讨论区"
      textTitle="讨论区"
      wide
      actions={
        <Actions>
          <ButtonSmall neutral onClick={() => void load()}>
            刷新
          </ButtonSmall>
          <ButtonSmall onClick={() => setComposing(true)}>
            <CommentIcon size={15} />
            发起讨论
          </ButtonSmall>
        </Actions>
      }
    >
      <FeatureHeader>
        <div>
          <FeatureTitle>讨论区</FeatureTitle>
          <Intro>
            主题即文档，回复使用官方评论；讨论区和知识库使用同一账号与导航。
          </Intro>
        </div>
        <FeatureStats>
          {topics.length ? `${topics.length} 个主题` : "准备加载中"}
        </FeatureStats>
      </FeatureHeader>

      <Toolbar>
        <SearchBox>
          <InputSearch
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索讨论主题…"
          />
        </SearchBox>
        <ComposerToggle
          type="button"
          $active={composing}
          onClick={() => setComposing((current) => !current)}
        >
          <CommentIcon size={15} />
          {composing ? "收起编辑" : "快速发帖"}
        </ComposerToggle>
      </Toolbar>

      {composing && (
        <ComposerPanel>
          <ComposerTitle>发起一个新讨论</ComposerTitle>
          <ComposerFields>
            <ComposerInput
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void createTopic();
                }
              }}
              placeholder="用一句话写下讨论主题…"
            />
            <ComposerSelect
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
            >
              <option value="">不分版块</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </ComposerSelect>
            <ButtonSmall
              onClick={() => void createTopic()}
              disabled={!title.trim()}
            >
              发布
            </ButtonSmall>
            <ButtonSmall neutral onClick={() => setComposing(false)}>
              取消
            </ButtonSmall>
          </ComposerFields>
        </ComposerPanel>
      )}

      {categories.length > 0 && (
        <CategoryBar role="tablist" aria-label="讨论版块">
          <Category
            type="button"
            role="tab"
            aria-selected={!category}
            $active={!category}
            onClick={() => setCategory(null)}
          >
            全部 <CategoryCount>{topics.length}</CategoryCount>
          </Category>
          {categories.map((item) => {
            const count = topics.filter(
              (topic) => topic.parentDocumentId === item.id
            ).length;
            return (
              <Category
                type="button"
                role="tab"
                aria-selected={category === item.id}
                key={item.id}
                $active={category === item.id}
                onClick={() =>
                  setCategory(category === item.id ? null : item.id)
                }
              >
                {item.title} <CategoryCount>{count}</CategoryCount>
              </Category>
            );
          })}
        </CategoryBar>
      )}

      {error && <ErrorText role="alert">{error}</ErrorText>}
      <Summary>
        <strong>{visible.length}</strong> 个主题
        {category && categoryNames.get(category)
          ? ` · ${categoryNames.get(category)}`
          : ""}
        {query.trim() ? ` · 搜索“${query.trim()}”` : ""}
      </Summary>
      {loading ? (
        <Empty>正在加载讨论主题…</Empty>
      ) : !forumFound ? (
        <Empty>尚未找到“讨论区”或“论坛空间”集合。</Empty>
      ) : visible.length === 0 ? (
        <Empty>暂时没有匹配的讨论主题。</Empty>
      ) : (
        <List>
          {visible.map((topic) => (
            <Row
              key={topic.id}
              role="button"
              tabIndex={0}
              onClick={() => openTopic(topic)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openTopic(topic);
                }
              }}
            >
              <Avatar aria-hidden>
                {(topic.createdBy?.name ?? "成").slice(0, 1)}
              </Avatar>
              <TopicMain>
                <TopicTitle>
                  {pins[topic.id] && <PinIcon size={13} aria-label="已置顶" />}
                  {topic.title || "无标题"}
                </TopicTitle>
                <TopicMeta>
                  <span>{topic.createdBy?.name ?? "成员"}</span>
                  {topic.createdAt && (
                    <span>
                      · {new Date(topic.createdAt).toLocaleDateString()}
                    </span>
                  )}
                  {topic.parentDocumentId &&
                    categoryNames.get(topic.parentDocumentId) && (
                      <TopicCategory>
                        {categoryNames.get(topic.parentDocumentId)}
                      </TopicCategory>
                    )}
                </TopicMeta>
              </TopicMain>
              <RowActions>
                <Tooltip
                  content={likes[topic.id] ? "取消点赞" : "点赞"}
                  placement="bottom"
                >
                  <IconButton
                    type="button"
                    aria-label={likes[topic.id] ? "取消点赞" : "点赞"}
                    aria-pressed={!!likes[topic.id]}
                    $active={!!likes[topic.id]}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleLike(topic.id);
                    }}
                  >
                    <ThumbsUpIcon size={15} />
                  </IconButton>
                </Tooltip>
                <Tooltip
                  content={pins[topic.id] ? "取消置顶" : "置顶"}
                  placement="bottom"
                >
                  <IconButton
                    type="button"
                    aria-label={pins[topic.id] ? "取消置顶" : "置顶"}
                    aria-pressed={!!pins[topic.id]}
                    $active={!!pins[topic.id]}
                    onClick={(event) => {
                      event.stopPropagation();
                      void togglePin(topic.id);
                    }}
                  >
                    <PinIcon size={15} />
                  </IconButton>
                </Tooltip>
                <Tooltip content="打开主题" placement="bottom">
                  <OpenButton
                    type="button"
                    aria-label="打开主题"
                    onClick={(event) => {
                      event.stopPropagation();
                      openTopic(topic);
                    }}
                  >
                    <OpenIcon size={15} />
                  </OpenButton>
                </Tooltip>
              </RowActions>
            </Row>
          ))}
        </List>
      )}
    </Scene>
  );
}

const Actions = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;

  svg {
    margin-right: 5px;
    vertical-align: -3px;
  }
`;
const FeatureHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin: 18px 0 12px;
`;
const FeatureTitle = styled.h2`
  margin: 0 0 4px;
  font-size: 20px;
  letter-spacing: -0.02em;
`;
const FeatureStats = styled.div`
  flex-shrink: 0;
  padding-top: 4px;
  color: ${(props) => props.theme.textTertiary};
  font-size: 13px;
`;
const Intro = styled.p`
  margin: 0;
  color: ${(p) => p.theme.textTertiary};
  font-size: 13px;
`;
const Toolbar = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 18px 0 12px;

  @media (max-width: 700px) {
    align-items: stretch;
    flex-direction: column;
  }
`;
const SearchBox = styled.div`
  flex: 1;
  min-width: 180px;
`;
const ComposerToggle = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 10px;
  border: 1px solid ${(p) => (p.$active ? p.theme.accent : p.theme.divider)};
  border-radius: 6px;
  color: ${(p) => (p.$active ? p.theme.accent : p.theme.textSecondary)};
  background: transparent;
  font-size: 13px;
  cursor: pointer;

  svg {
    margin-right: 6px;
  }

  &:hover {
    background: ${(p) => p.theme.backgroundSecondary};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.inputBorderFocused};
    outline-offset: 1px;
  }
`;
const ComposerPanel = styled.section`
  margin-bottom: 14px;
  padding: 14px;
  border: 1px solid ${(p) => p.theme.divider};
  border-radius: 8px;
  background: ${(p) => p.theme.backgroundSecondary};
`;
const ComposerTitle = styled.div`
  margin-bottom: 10px;
  color: ${(p) => p.theme.text};
  font-size: 13px;
  font-weight: 600;
`;
const ComposerFields = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;

  @media (max-width: 700px) {
    align-items: stretch;
    flex-direction: column;
  }
`;
const ComposerInput = styled.input`
  min-width: 0;
  flex: 1;
  height: 32px;
  padding: 0 9px;
  border: 1px solid ${(p) => p.theme.divider};
  border-radius: 6px;
  color: ${(p) => p.theme.text};
  background: ${(p) => p.theme.background};
  font: inherit;
`;
const ComposerSelect = styled.select`
  height: 32px;
  padding: 0 8px;
  border: 1px solid ${(p) => p.theme.divider};
  border-radius: 6px;
  color: ${(p) => p.theme.text};
  background: ${(p) => p.theme.background};
  font: inherit;
`;
const CategoryBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid ${(p) => p.theme.divider};
`;
const Category = styled.button<{ $active: boolean }>`
  display: inline-flex;
  gap: 5px;
  align-items: center;
  padding: 5px 9px;
  border: 1px solid ${(p) => (p.$active ? p.theme.accent : p.theme.divider)};
  border-radius: 999px;
  color: ${(p) => (p.$active ? p.theme.accent : p.theme.textTertiary)};
  background: ${(p) =>
    p.$active ? p.theme.backgroundSecondary : "transparent"};
  font-size: 12px;
  cursor: pointer;

  &:hover {
    color: ${(p) => p.theme.text};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.inputBorderFocused};
    outline-offset: 1px;
  }
`;
const CategoryCount = styled.span`
  color: ${(p) => p.theme.textTertiary};
  font-size: 11px;
`;
const ErrorText = styled.p`
  margin: 10px 0;
  padding: 8px 10px;
  border-radius: 6px;
  color: ${(p) => p.theme.danger};
  background: ${(p) => p.theme.backgroundSecondary};
  font-size: 13px;
`;
const Summary = styled.div`
  margin: 14px 0 6px;
  color: ${(p) => p.theme.textTertiary};
  font-size: 13px;

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
  gap: 10px;
  align-items: center;
  padding: 12px 10px;
  border-bottom: 1px solid ${(p) => p.theme.divider};
  border-radius: 6px;
  cursor: pointer;

  &:hover {
    background: ${(p) => p.theme.backgroundSecondary};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.inputBorderFocused};
    outline-offset: -2px;
  }
`;
const Avatar = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 50%;
  color: ${(props) => props.theme.textSecondary};
  background: ${(props) => props.theme.sidebarActiveBackground};
  font-size: 13px;
  font-weight: 600;
`;
const TopicMain = styled.div`
  min-width: 0;
  flex: 1;
`;
const TopicTitle = styled.div`
  display: flex;
  gap: 5px;
  align-items: center;
  overflow: hidden;
  color: ${(p) => p.theme.text};
  font-size: 15px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;

  svg {
    flex-shrink: 0;
    color: ${(p) => p.theme.accent};
  }
`;
const TopicMeta = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 5px;
  overflow: hidden;
  color: ${(p) => p.theme.textTertiary};
  font-size: 12px;
  white-space: nowrap;
`;
const TopicCategory = styled.span`
  overflow: hidden;
  padding: 1px 6px;
  border-radius: 4px;
  color: ${(p) => p.theme.textSecondary};
  background: ${(p) => p.theme.backgroundSecondary};
  text-overflow: ellipsis;
`;
const RowActions = styled.div`
  display: flex;
  gap: 2px;
  align-items: center;
  flex-shrink: 0;
`;
const IconButton = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  color: ${(p) => (p.$active ? p.theme.accent : p.theme.textTertiary)};
  background: transparent;
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
const OpenButton = styled(IconButton)`
  color: ${(p) => p.theme.textTertiary};
`;
