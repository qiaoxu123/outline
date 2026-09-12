import {
  CollapsedIcon,
  CollectionIcon,
  DocumentIcon,
  NotepadIcon,
  PlusIcon,
} from "outline-icons";
import * as React from "react";
import { useHistory } from "react-router-dom";
import styled from "styled-components";
import { UserPreference } from "@shared/types";
import { ProsemirrorDataHelper } from "@shared/utils/ProsemirrorDataHelper";
import ButtonSmall from "~/components/ButtonSmall";
import Empty from "~/components/Empty";
import Scene from "~/components/Scene";
import useCurrentUser from "~/hooks/useCurrentUser";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import { documentEditPath } from "~/utils/routeHelpers";
import { openInTab } from "~/utils/tabNavigation";
import {
  collectionDocuments,
  listCollections,
  type CustomCollection,
  type CustomDocument,
} from "./customData";
import {
  buildPersonalDirectoryParams,
  findPersonalRoot,
  parseDocumentInfoResult,
  parsePersonalRootResult,
  selectPersonalDirectoryDocuments,
  sortPersonalDocuments,
  type PersonalRoot,
} from "./PersonalNotesHelpers";

type PersonalSnapshot = {
  savedAt: number;
  rootDocument: CustomDocument;
  path: string[];
  children: CustomDocument[];
};

type PickerOption = {
  collectionId: string;
  document: CustomDocument;
  path: string[];
};

const cachePrefix = "outline.desktop.personal-space.snapshot.v1";
const memberCollectionPattern = /成员(?:空间|笔记)/;

function snapshotKey(scope: string, root: PersonalRoot): string {
  return `${cachePrefix}.${scope}.${root.collectionId}.${root.docId}`;
}

function readSnapshot(
  scope: string,
  root: PersonalRoot
): PersonalSnapshot | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(snapshotKey(scope, root)) ?? "null"
    ) as PersonalSnapshot | null;
    return value?.rootDocument?.id === root.docId &&
      Array.isArray(value.children) &&
      Array.isArray(value.path)
      ? value
      : null;
  } catch {
    return null;
  }
}

function writeSnapshot(
  scope: string,
  root: PersonalRoot,
  snapshot: PersonalSnapshot
): void {
  try {
    localStorage.setItem(snapshotKey(scope, root), JSON.stringify(snapshot));
  } catch {
    // A full browser cache must never prevent access to the server directory.
  }
}

async function listDirectoryChildren(
  root: PersonalRoot,
  parentDocumentId = root.docId
): Promise<CustomDocument[]> {
  const result: CustomDocument[] = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const response = await client.post<{ data: CustomDocument[] }>(
      "/documents.list",
      buildPersonalDirectoryParams(root, parentDocumentId, offset)
    );
    const page = response.data ?? [];
    result.push(
      ...selectPersonalDirectoryDocuments(page, root, parentDocumentId)
    );
    if (page.length < 100) {
      break;
    }
  }
  return sortPersonalDocuments(result);
}

async function documentInfo(id: string): Promise<CustomDocument> {
  const response = await client.post<unknown>("/documents.info", { id });
  const document = parseDocumentInfoResult(response);
  if (!document) {
    throw new Error("Invalid documents.info response");
  }
  return document;
}

async function collectionInfo(id: string): Promise<CustomCollection> {
  const response = await client.post<{ data: CustomCollection }>(
    "/collections.info",
    { id }
  );
  return response.data;
}

async function buildRootPath(
  rootDocument: CustomDocument,
  collectionName: string
): Promise<string[]> {
  const result = [rootDocument.title.trim() || "未命名目录"];
  let parentId = rootDocument.parentDocumentId;
  let depth = 0;

  while (parentId && depth < 6) {
    try {
      const parent = await documentInfo(parentId);
      result.unshift(parent.title.trim() || "未命名目录");
      parentId = parent.parentDocumentId;
      depth += 1;
    } catch {
      break;
    }
  }
  result.unshift(collectionName || "成员空间");
  return result;
}

function flattenPickerOptions(
  collectionId: string,
  collectionName: string,
  tree: CustomDocument[]
): PickerOption[] {
  const result: PickerOption[] = [];
  const visit = (items: CustomDocument[], ancestors: string[]) => {
    for (const document of items) {
      const title = document.title.trim() || "未命名目录";
      const path = [...ancestors, title];
      result.push({ collectionId, document, path: [collectionName, ...path] });
      visit(document.children ?? [], path);
    }
  };
  visit(tree, []);
  return result;
}

function documentUrl(document: CustomDocument): string {
  return document.url ?? `/doc/${document.urlId ?? document.id}`;
}

function formatUpdatedAt(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

type DirectoryNodeProps = {
  document: CustomDocument;
  depth: number;
  expanded: Set<string>;
  loadedParents: Set<string>;
  loadingParents: Set<string>;
  childrenByParent: Record<string, CustomDocument[]>;
  onToggle: (documentId: string) => void;
  onOpen: (document: CustomDocument) => void;
};

function DirectoryNode({
  document,
  depth,
  expanded,
  loadedParents,
  loadingParents,
  childrenByParent,
  onToggle,
  onOpen,
}: DirectoryNodeProps) {
  const children = childrenByParent[document.id] ?? [];
  const isExpanded = expanded.has(document.id);
  const isLoaded = loadedParents.has(document.id);
  const isLoading = loadingParents.has(document.id);
  const canExpand = !isLoaded || children.length > 0;
  const updatedAt = formatUpdatedAt(document.updatedAt);

  return (
    <>
      <DirectoryRow $depth={depth}>
        <DisclosureButton
          type="button"
          $expanded={isExpanded}
          $visible={canExpand}
          disabled={!canExpand || isLoading}
          aria-label={isExpanded ? "收起子目录" : "展开子目录"}
          aria-expanded={isExpanded}
          onClick={() => onToggle(document.id)}
        >
          {isLoading ? <LoadingDot aria-hidden /> : <CollapsedIcon size={18} />}
        </DisclosureButton>
        <DocumentButton type="button" onClick={() => onOpen(document)}>
          <TypeIcon aria-hidden>
            {canExpand ? (
              <CollectionIcon size={18} />
            ) : (
              <DocumentIcon size={18} />
            )}
          </TypeIcon>
          <DocumentTitle>{document.title.trim() || "未命名文档"}</DocumentTitle>
          <DocumentMeta>
            {isLoaded && children.length > 0
              ? `${children.length} 项`
              : updatedAt
                ? `${updatedAt} 更新`
                : "打开文档"}
          </DocumentMeta>
        </DocumentButton>
      </DirectoryRow>
      {isExpanded &&
        children.map((child) => (
          <DirectoryNode
            key={child.id}
            document={child}
            depth={depth + 1}
            expanded={expanded}
            loadedParents={loadedParents}
            loadingParents={loadingParents}
            childrenByParent={childrenByParent}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        ))}
    </>
  );
}

export default function PersonalNotes() {
  const history = useHistory();
  const user = useCurrentUser();
  const { documents, tabs, auth, collections } = useStores();
  const scope = auth.currentTeamId ?? window.location.host;
  const [root, setRoot] = React.useState<PersonalRoot | null>(null);
  const [rootDocument, setRootDocument] = React.useState<CustomDocument | null>(
    null
  );
  const [path, setPath] = React.useState<string[]>([]);
  const [childrenByParent, setChildrenByParent] = React.useState<
    Record<string, CustomDocument[]>
  >({});
  const [loadedParents, setLoadedParents] = React.useState<Set<string>>(
    () => new Set()
  );
  const [loadingParents, setLoadingParents] = React.useState<Set<string>>(
    () => new Set()
  );
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [discovering, setDiscovering] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerLoading, setPickerLoading] = React.useState(false);
  const [pickerOptions, setPickerOptions] = React.useState<PickerOption[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const loadRoot = React.useCallback(
    async (configuredRoot: PersonalRoot, force = false) => {
      const cached = readSnapshot(scope, configuredRoot);
      if (cached && !force) {
        setRootDocument(cached.rootDocument);
        setPath(cached.path);
        setChildrenByParent({
          [configuredRoot.docId]: cached.children,
        });
        setLoadedParents(new Set([configuredRoot.docId]));
        setLoading(false);
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const knownCollection = collections.get(configuredRoot.collectionId);
        const [rootInfo, children, fetchedCollection] = await Promise.all([
          documentInfo(configuredRoot.docId),
          listDirectoryChildren(configuredRoot),
          knownCollection
            ? Promise.resolve({ name: knownCollection.name })
            : collectionInfo(configuredRoot.collectionId),
        ]);
        const nextPath = await buildRootPath(rootInfo, fetchedCollection.name);
        setRootDocument(rootInfo);
        setPath(nextPath);
        setChildrenByParent((current) => ({
          ...current,
          [configuredRoot.docId]: children,
        }));
        setLoadedParents((current) =>
          new Set(current).add(configuredRoot.docId)
        );
        writeSnapshot(scope, configuredRoot, {
          savedAt: Date.now(),
          rootDocument: rootInfo,
          path: nextPath,
          children,
        });
      } catch {
        if (!cached) {
          setError(
            "无法读取已设置的成员目录。它可能已被移动、删除，或当前账号没有访问权限。"
          );
        } else {
          setError("当前显示的是本地缓存，连接恢复后可点击刷新同步最新内容。");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [collections, scope]
  );

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const value = await window.DesktopBridge?.getPersonalNotesRoot?.();
        if (cancelled) {
          return;
        }
        const configuredRoot = parsePersonalRootResult(value);
        setRoot(configuredRoot);
        if (configuredRoot) {
          await loadRoot(configuredRoot);
        } else {
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError("无法读取个人空间设置，请重新定位目录。");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRoot]);

  const saveRoot = React.useCallback(
    async (nextRoot: PersonalRoot) => {
      const bridge = window.DesktopBridge;
      if (!bridge?.setPersonalNotesRoot) {
        throw new Error("当前环境不支持保存个人空间设置");
      }
      const result = await bridge.setPersonalNotesRoot(nextRoot);
      const saved = parsePersonalRootResult(result);
      if (!saved) {
        throw new Error("个人空间目录保存失败");
      }
      setRoot(saved);
      setRootDocument(null);
      setPath([]);
      setChildrenByParent({});
      setLoadedParents(new Set());
      setExpanded(new Set());
      setPickerOpen(false);
      await loadRoot(saved, true);
    },
    [loadRoot]
  );

  const autoLocate = React.useCallback(async () => {
    setDiscovering(true);
    setError(null);
    try {
      const availableCollections = await listCollections();
      const memberCollections = availableCollections.filter((collection) =>
        memberCollectionPattern.test(collection.name.trim())
      );
      for (const collection of memberCollections) {
        const tree = await collectionDocuments(collection.id);
        const detected = findPersonalRoot(tree, user.name);
        if (detected) {
          await saveRoot({
            docId: detected.id,
            collectionId: collection.id,
          });
          return;
        }
      }
      setError(
        `没有在“成员空间”中找到与当前姓名“${user.name}”完全匹配的目录，请手动选择。`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "自动定位目录失败");
    } finally {
      setDiscovering(false);
    }
  }, [saveRoot, user.name]);

  const openPicker = React.useCallback(async () => {
    setPickerOpen(true);
    if (pickerOptions.length) {
      return;
    }
    setPickerLoading(true);
    setError(null);
    try {
      const availableCollections = await listCollections();
      const memberCollections = availableCollections.filter((collection) =>
        memberCollectionPattern.test(collection.name.trim())
      );
      const candidates = memberCollections.length
        ? memberCollections
        : availableCollections;
      const groups = await Promise.all(
        candidates.map(async (collection) =>
          flattenPickerOptions(
            collection.id,
            collection.name,
            await collectionDocuments(collection.id)
          )
        )
      );
      setPickerOptions(groups.flat());
    } catch {
      setError("目录列表加载失败，请检查网络后重试。");
    } finally {
      setPickerLoading(false);
    }
  }, [pickerOptions.length]);

  const loadChildren = React.useCallback(
    async (parentDocumentId: string) => {
      if (
        !root ||
        loadedParents.has(parentDocumentId) ||
        loadingParents.has(parentDocumentId)
      ) {
        return;
      }
      setLoadingParents((current) => new Set(current).add(parentDocumentId));
      try {
        const children = await listDirectoryChildren(root, parentDocumentId);
        setChildrenByParent((current) => ({
          ...current,
          [parentDocumentId]: children,
        }));
        setLoadedParents((current) => new Set(current).add(parentDocumentId));
      } catch {
        setError("子目录加载失败，请稍后重试。");
        setExpanded((current) => {
          const next = new Set(current);
          next.delete(parentDocumentId);
          return next;
        });
      } finally {
        setLoadingParents((current) => {
          const next = new Set(current);
          next.delete(parentDocumentId);
          return next;
        });
      }
    },
    [loadedParents, loadingParents, root]
  );

  const toggleDirectory = React.useCallback(
    (documentId: string) => {
      const willExpand = !expanded.has(documentId);
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(documentId)) {
          next.delete(documentId);
        } else {
          next.add(documentId);
        }
        return next;
      });
      if (willExpand) {
        void loadChildren(documentId);
      }
    },
    [expanded, loadChildren]
  );

  const openDocument = React.useCallback(
    (document: CustomDocument) => {
      openInTab(history, tabs, {
        id: document.id,
        url: documents.get(document.id)?.url ?? documentUrl(document),
        title: document.title.trim() || "未命名文档",
      });
    },
    [documents, history, tabs]
  );

  const createDocument = React.useCallback(async () => {
    if (!root || creating) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await documents.create(
        {
          collectionId: root.collectionId,
          parentDocumentId: root.docId,
          fullWidth: user.getPreference(UserPreference.FullWidthDocuments),
          title: "",
          data: ProsemirrorDataHelper.getEmpty(),
        },
        { publish: true }
      );
      collections.get(root.collectionId)?.addDocument(created, root.docId);
      setChildrenByParent((current) => ({
        ...current,
        [root.docId]: sortPersonalDocuments([
          ...(current[root.docId] ?? []),
          {
            id: created.id,
            title: created.title,
            collectionId: root.collectionId,
            parentDocumentId: root.docId,
            url: created.url,
            updatedAt: new Date().toISOString(),
          },
        ]),
      }));
      openInTab(history, tabs, {
        id: created.id,
        url: documentEditPath(created),
        title: "未命名文档",
      });
    } catch {
      setError("新建文档失败，请确认你对该成员目录拥有编辑权限。");
    } finally {
      setCreating(false);
    }
  }, [collections, creating, documents, history, root, tabs, user]);

  const rootChildren = root ? (childrenByParent[root.docId] ?? []) : [];
  const actions = root ? (
    <Actions>
      <ButtonSmall neutral onClick={() => void openPicker()}>
        更换目录
      </ButtonSmall>
      <ButtonSmall
        neutral
        disabled={refreshing}
        onClick={() => void loadRoot(root, true)}
      >
        {refreshing ? "同步中…" : "刷新"}
      </ButtonSmall>
      <ButtonSmall
        icon={<PlusIcon />}
        disabled={creating}
        onClick={() => void createDocument()}
      >
        {creating ? "新建中…" : "新建文档"}
      </ButtonSmall>
    </Actions>
  ) : undefined;

  return (
    <Scene
      icon={<NotepadIcon />}
      title="个人空间"
      textTitle="个人空间"
      wide
      actions={actions}
    >
      {loading && !rootDocument ? <Empty>正在读取个人空间…</Empty> : null}

      {!loading && !root ? (
        <SetupCard>
          <SetupIcon>
            <NotepadIcon size={34} />
          </SetupIcon>
          <SetupContent>
            <SetupEyebrow>成员空间目录</SetupEyebrow>
            <SetupTitle>连接你的个人工作目录</SetupTitle>
            <SetupDescription>
              个人空间不会复制文档，而是直接显示“成员空间”中属于你的指定目录，
              编辑与权限仍由 Outline 统一管理。
            </SetupDescription>
            <SetupActions>
              <ButtonSmall
                disabled={discovering}
                onClick={() => void autoLocate()}
              >
                {discovering ? "正在定位…" : "按姓名自动定位"}
              </ButtonSmall>
              <ButtonSmall neutral onClick={() => void openPicker()}>
                手动选择目录
              </ButtonSmall>
            </SetupActions>
          </SetupContent>
        </SetupCard>
      ) : null}

      {root && rootDocument ? (
        <>
          <DirectoryHero>
            <HeroMark aria-hidden>
              <NotepadIcon size={28} />
            </HeroMark>
            <HeroContent>
              <HeroEyebrow>我的成员目录</HeroEyebrow>
              <HeroTitle>{rootDocument.title || "未命名目录"}</HeroTitle>
              <Breadcrumb aria-label="目录位置">
                {path.map((segment, index) => (
                  <React.Fragment key={`${segment}-${index}`}>
                    {index > 0 ? <PathSeparator>/</PathSeparator> : null}
                    <span>{segment}</span>
                  </React.Fragment>
                ))}
              </Breadcrumb>
            </HeroContent>
            <HeroStat>
              <strong>{rootChildren.length}</strong>
              <span>个一级条目</span>
            </HeroStat>
          </DirectoryHero>

          <DirectoryPanel>
            <PanelHeader>
              <div>
                <PanelTitle>目录内容</PanelTitle>
                <PanelHint>
                  展开目录按需加载子项，点击标题使用官方编辑器打开。
                </PanelHint>
              </div>
              {refreshing ? <SyncStatus>正在同步最新内容…</SyncStatus> : null}
            </PanelHeader>
            {rootChildren.length ? (
              <DirectoryList>
                {rootChildren.map((document) => (
                  <DirectoryNode
                    key={document.id}
                    document={document}
                    depth={0}
                    expanded={expanded}
                    loadedParents={loadedParents}
                    loadingParents={loadingParents}
                    childrenByParent={childrenByParent}
                    onToggle={toggleDirectory}
                    onOpen={openDocument}
                  />
                ))}
              </DirectoryList>
            ) : (
              <EmptyState>
                <DocumentIcon size={24} />
                <strong>这个目录还是空的</strong>
                <span>点击右上角“新建文档”开始记录。</span>
              </EmptyState>
            )}
          </DirectoryPanel>
        </>
      ) : null}

      {pickerOpen ? (
        <PickerPanel>
          <PickerHeader>
            <div>
              <PanelTitle>选择成员目录</PanelTitle>
              <PanelHint>
                这里只保存目录指针；选择后，页面仅显示该目录及其子项。
              </PanelHint>
            </div>
            <ButtonSmall neutral onClick={() => setPickerOpen(false)}>
              关闭
            </ButtonSmall>
          </PickerHeader>
          {pickerLoading ? <Empty>正在读取目录结构…</Empty> : null}
          {!pickerLoading && pickerOptions.length === 0 ? (
            <Empty>没有找到可选择的目录。</Empty>
          ) : null}
          {!pickerLoading && pickerOptions.length > 0 ? (
            <PickerList>
              {pickerOptions.map((option) => (
                <PickerRow
                  key={`${option.collectionId}-${option.document.id}`}
                  type="button"
                  $selected={root?.docId === option.document.id}
                  onClick={() =>
                    void saveRoot({
                      docId: option.document.id,
                      collectionId: option.collectionId,
                    }).catch((caught) =>
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : "目录保存失败"
                      )
                    )
                  }
                >
                  <CollectionIcon size={18} />
                  <PickerText>
                    <strong>
                      {option.document.title.trim() || "未命名目录"}
                    </strong>
                    <span>{option.path.join(" / ")}</span>
                  </PickerText>
                  {root?.docId === option.document.id ? (
                    <CurrentBadge>当前</CurrentBadge>
                  ) : null}
                </PickerRow>
              ))}
            </PickerList>
          ) : null}
        </PickerPanel>
      ) : null}

      {error ? <ErrorMessage role="alert">{error}</ErrorMessage> : null}
    </Scene>
  );
}

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const DirectoryHero = styled.section`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  margin: 24px 0 18px;
  padding: 22px 24px;
  border: 1px solid ${({ theme }) => theme.divider};
  border-radius: 14px;
  background: linear-gradient(
    135deg,
    ${({ theme }) => theme.background},
    ${({ theme }) => theme.sidebarBackground}
  );

  @media (max-width: 700px) {
    grid-template-columns: auto minmax(0, 1fr);
    padding: 18px;
  }
`;

const HeroMark = styled.div`
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  color: ${({ theme }) => theme.accent};
  background: ${({ theme }) => theme.accent}14;
`;

const HeroContent = styled.div`
  min-width: 0;
`;

const HeroEyebrow = styled.div`
  margin-bottom: 3px;
  color: ${({ theme }) => theme.textSecondary};
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
`;

const HeroTitle = styled.h2`
  margin: 0;
  font-size: 22px;
  line-height: 1.3;
`;

const Breadcrumb = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  margin-top: 7px;
  color: ${({ theme }) => theme.textSecondary};
  font-size: 13px;
  overflow: hidden;

  span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
`;

const PathSeparator = styled.i`
  opacity: 0.5;
  font-style: normal;
`;

const HeroStat = styled.div`
  display: grid;
  justify-items: end;
  min-width: 88px;
  color: ${({ theme }) => theme.textSecondary};
  font-size: 12px;

  strong {
    color: ${({ theme }) => theme.text};
    font-size: 24px;
    font-weight: 650;
    line-height: 1.1;
  }

  @media (max-width: 700px) {
    display: none;
  }
`;

const DirectoryPanel = styled.section`
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.divider};
  border-radius: 12px;
  background: ${({ theme }) => theme.background};
`;

const PanelHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 15px 18px;
  border-bottom: 1px solid ${({ theme }) => theme.divider};
`;

const PanelTitle = styled.h3`
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
`;

const PanelHint = styled.div`
  margin-top: 2px;
  color: ${({ theme }) => theme.textSecondary};
  font-size: 12px;
`;

const SyncStatus = styled.span`
  flex-shrink: 0;
  color: ${({ theme }) => theme.textSecondary};
  font-size: 12px;
`;

const DirectoryList = styled.div`
  padding: 6px 0;
`;

const DirectoryRow = styled.div<{ $depth: number }>`
  display: flex;
  align-items: center;
  min-width: 0;
  height: 42px;
  padding: 0 12px 0 ${({ $depth }) => 14 + $depth * 24}px;

  &:hover {
    background: ${({ theme }) => theme.sidebarHoverBackground};
  }
`;

const DisclosureButton = styled.button<{
  $expanded: boolean;
  $visible: boolean;
}>`
  display: grid;
  place-items: center;
  flex: 0 0 26px;
  width: 26px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: ${({ theme }) => theme.textSecondary};
  cursor: ${({ $visible }) => ($visible ? "var(--pointer)" : "default")};
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};

  svg {
    transform: rotate(${({ $expanded }) => ($expanded ? "0deg" : "-90deg")});
    transition: transform 120ms ease;
  }

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.buttonNeutralHoverBackground};
  }
`;

const LoadingDot = styled.span`
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 700ms linear infinite;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

const DocumentButton = styled.button`
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
  height: 100%;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: ${({ theme }) => theme.text};
  text-align: left;
  cursor: var(--pointer);
`;

const TypeIcon = styled.span`
  display: grid;
  place-items: center;
  flex: 0 0 24px;
  color: ${({ theme }) => theme.textSecondary};
`;

const DocumentTitle = styled.strong`
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 14px;
  font-weight: 500;
`;

const DocumentMeta = styled.span`
  flex-shrink: 0;
  margin-left: auto;
  padding-left: 20px;
  color: ${({ theme }) => theme.textSecondary};
  font-size: 12px;
`;

const EmptyState = styled.div`
  display: grid;
  justify-items: center;
  gap: 5px;
  padding: 54px 20px;
  color: ${({ theme }) => theme.textSecondary};

  strong {
    margin-top: 7px;
    color: ${({ theme }) => theme.text};
    font-size: 14px;
  }

  span {
    font-size: 13px;
  }
`;

const SetupCard = styled.section`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 22px;
  max-width: 720px;
  margin: 48px auto 20px;
  padding: 30px;
  border: 1px solid ${({ theme }) => theme.divider};
  border-radius: 14px;
  background: ${({ theme }) => theme.background};
`;

const SetupIcon = styled.div`
  display: grid;
  place-items: center;
  width: 62px;
  height: 62px;
  border-radius: 16px;
  color: ${({ theme }) => theme.accent};
  background: ${({ theme }) => theme.accent}14;
`;

const SetupContent = styled.div`
  min-width: 0;
`;

const SetupEyebrow = styled.div`
  color: ${({ theme }) => theme.textSecondary};
  font-size: 12px;
  font-weight: 600;
`;

const SetupTitle = styled.h2`
  margin: 4px 0 8px;
  font-size: 20px;
`;

const SetupDescription = styled.p`
  max-width: 560px;
  margin: 0;
  color: ${({ theme }) => theme.textSecondary};
  font-size: 14px;
  line-height: 1.7;
`;

const SetupActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
`;

const PickerPanel = styled.section`
  margin-top: 18px;
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.divider};
  border-radius: 12px;
  background: ${({ theme }) => theme.background};
`;

const PickerHeader = styled(PanelHeader)``;

const PickerList = styled.div`
  max-height: 440px;
  padding: 6px;
  overflow: auto;
`;

const PickerRow = styled.button<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 48px;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  background: ${({ $selected, theme }) =>
    $selected ? theme.sidebarHoverBackground : "transparent"};
  color: ${({ theme }) => theme.text};
  text-align: left;
  cursor: var(--pointer);

  &:hover {
    background: ${({ theme }) => theme.sidebarHoverBackground};
  }

  > svg {
    flex-shrink: 0;
    color: ${({ theme }) => theme.textSecondary};
  }
`;

const PickerText = styled.span`
  display: grid;
  min-width: 0;
  gap: 2px;

  strong,
  span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  strong {
    font-size: 13px;
    font-weight: 500;
  }

  span {
    color: ${({ theme }) => theme.textSecondary};
    font-size: 11px;
  }
`;

const CurrentBadge = styled.span`
  flex-shrink: 0;
  margin-left: auto;
  padding: 2px 7px;
  border-radius: 999px;
  color: ${({ theme }) => theme.accent};
  background: ${({ theme }) => theme.accent}14;
  font-size: 11px;
  font-weight: 600;
`;

const ErrorMessage = styled.div`
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 8px;
  color: ${({ theme }) => theme.danger};
  background: ${({ theme }) => theme.danger}0d;
  font-size: 13px;
`;
