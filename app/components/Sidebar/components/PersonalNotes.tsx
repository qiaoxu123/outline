import type { Location } from "history";
import { observer } from "mobx-react";
import { DocumentIcon, NotepadIcon } from "outline-icons";
import * as React from "react";
import type { match } from "react-router";
import { useHistory } from "react-router-dom";
import styled from "styled-components";
import { s } from "@shared/styles";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import { openInTab } from "~/utils/tabNavigation";
import CollectionLink from "./CollectionLink";
import SidebarContext from "./SidebarContext";
import type { CustomDocument } from "~/scenes/customData";
import {
  isPersonalNotesCollectionName,
  buildPersonalDirectoryParams,
  parseDocumentInfoResult,
  parsePersonalRootResult,
  selectPersonalDirectoryDocuments,
  sortPersonalDocuments,
  type PersonalRoot,
} from "~/scenes/PersonalNotesHelpers";
import Header from "./Header";
import Section from "./Section";
import SidebarLink from "./SidebarLink";
import {
  isActiveInSidebarContext,
  type SidebarContextType,
} from "./SidebarContext";

type PersonalSnapshot = {
  rootDocument: CustomDocument;
  children: CustomDocument[];
};

const cachePrefix = "outline.desktop.personal-space.snapshot.v1";
const personalNotesContext: SidebarContextType = "personal-notes";

const isPersonalNotesLinkActive = (
  routeMatch: match | null,
  location: Location<unknown>
) => {
  const state = location.state as
    | { sidebarContext?: SidebarContextType }
    | undefined;
  return isActiveInSidebarContext(
    !!routeMatch,
    state?.sidebarContext,
    personalNotesContext
  );
};

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
      Array.isArray(value.children)
      ? value
      : null;
  } catch {
    return null;
  }
}

async function listDirectoryChildren(
  root: PersonalRoot,
  parentDocumentId: string
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
  const document = parseDocumentInfoResult(
    await client.post<unknown>("/documents.info", { id })
  );
  if (!document) {
    throw new Error("Invalid documents.info response");
  }
  return document;
}

function documentUrl(document: CustomDocument): string {
  return document.url ?? `/doc/${document.urlId ?? document.id}`;
}

type DocumentNodeProps = {
  document: CustomDocument;
  depth: number;
  expanded: Set<string>;
  loadedParents: Set<string>;
  loadingParents: Set<string>;
  childrenByParent: Record<string, CustomDocument[]>;
  onToggle: (documentId: string) => void;
  onOpen: (document: CustomDocument) => void;
};

function DocumentNode({
  document,
  depth,
  expanded,
  loadedParents,
  loadingParents,
  childrenByParent,
  onToggle,
  onOpen,
}: DocumentNodeProps) {
  const children = childrenByParent[document.id] ?? [];
  const isExpanded = expanded.has(document.id);
  const isLoaded = loadedParents.has(document.id);
  const isLoading = loadingParents.has(document.id);
  const canExpand = !isLoaded || children.length > 0;

  return (
    <>
      <SidebarLink
        to={{
          pathname: documentUrl(document),
          state: { sidebarContext: personalNotesContext },
        }}
        icon={<DocumentIcon />}
        label={document.title.trim() || "未命名文档"}
        depth={depth}
        iconIndentBase={12}
        expanded={canExpand ? isExpanded : undefined}
        disabled={isLoading}
        scrollIntoViewIfNeeded={false}
        isActive={isPersonalNotesLinkActive}
        onDisclosureClick={() => onToggle(document.id)}
        onClick={(event) => {
          event.preventDefault();
          onOpen(document);
        }}
      />
      {isExpanded &&
        children.map((child) => (
          <DocumentNode
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

// Reuse Outline's real collection/document tree: document expansion, permissions,
// tabs, editing and creation then behave exactly as in the ordinary sidebar.
function PersonalCollection({ collection }: { collection: import("~/models/Collection").default }) {
  const { documents } = useStores();
  const [expanded, setExpanded] = React.useState(true);
  return (
    <SidebarContext.Provider value="personal-notes">
      <CollectionLink
        collection={collection}
        activeDocument={documents.active}
        expanded={expanded}
        onDisclosureClick={(event) => {
          event?.preventDefault();
          setExpanded((current) => !current);
        }}
      />
    </SidebarContext.Provider>
  );
}

function PersonalNotes() {
  const history = useHistory();
  const { auth, documents, tabs, collections } = useStores();
  const personalCollections =
    typeof window !== "undefined" && window.DesktopBridge
      ? collections.allActive.filter((collection) =>
          isPersonalNotesCollectionName(collection.name)
        )
      : [];

  const scope = auth.currentTeamId ?? window.location.host;
  const [root, setRoot] = React.useState<PersonalRoot | null>(null);
  const [rootDocument, setRootDocument] = React.useState<CustomDocument | null>(
    null
  );
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
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const configuredRoot = parsePersonalRootResult(
          await window.DesktopBridge?.getPersonalNotesRoot?.()
        );
        if (cancelled) {
          return;
        }
        setRoot(configuredRoot);
        if (!configuredRoot) {
          setLoading(false);
          return;
        }

        const cached = readSnapshot(scope, configuredRoot);
        if (cached) {
          setRootDocument(cached.rootDocument);
          setChildrenByParent({ [configuredRoot.docId]: cached.children });
          setLoadedParents(new Set([configuredRoot.docId]));
          setExpanded(new Set([configuredRoot.docId]));
          setLoading(false);
        }

        const [nextRootDocument, children] = await Promise.all([
          documentInfo(configuredRoot.docId),
          listDirectoryChildren(configuredRoot, configuredRoot.docId),
        ]);
        if (cancelled) {
          return;
        }
        setRootDocument(nextRootDocument);
        setChildrenByParent({ [configuredRoot.docId]: children });
        setLoadedParents(new Set([configuredRoot.docId]));
        setExpanded((current) => new Set(current).add(configuredRoot.docId));
      } catch {
        if (!cancelled) {
          setError(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

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

  const toggle = React.useCallback(
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
        sidebarContext: personalNotesContext,
      });
    },
    [documents, history, tabs]
  );

  return (
    <Section>
      <Header id="personal-notes" title="个人笔记">
        {personalCollections.map((collection) => (
          <PersonalCollection key={collection.id} collection={collection} />
        ))}
        {loading && personalCollections.length === 0 ? (
          <Status>正在读取成员目录…</Status>
        ) : null}
        {!loading && !root ? (
          <SidebarLink
            to="/personal-notes"
            icon={<NotepadIcon />}
            label={personalCollections.length > 0 ? "关联成员目录（可选）" : "设置个人目录…"}
            iconIndentBase={12}
          />
        ) : null}
        {root && rootDocument &&
          !personalCollections.some((collection) => collection.id === root.collectionId) ? (
          <>
            {expanded.has(root.docId) &&
              (childrenByParent[root.docId] ?? []).map((child) => (
                <DocumentNode
                  key={child.id}
                  document={child}
                  depth={0}
                  expanded={expanded}
                  loadedParents={loadedParents}
                  loadingParents={loadingParents}
                  childrenByParent={childrenByParent}
                  onToggle={toggle}
                  onOpen={openDocument}
                />
              ))}
            {loadedParents.has(root.docId) &&
              (childrenByParent[root.docId] ?? []).length === 0 && (
                <SidebarLink
                  to={{
                    pathname: documentUrl(rootDocument),
                    state: { sidebarContext: personalNotesContext },
                  }}
                  icon={<NotepadIcon />}
                  label={personalCollections.length > 0 ? "成员目录为空，打开根目录" : "个人目录为空，打开根目录"}
                  iconIndentBase={12}
                  scrollIntoViewIfNeeded={false}
                  isActive={isPersonalNotesLinkActive}
                  onClick={(event) => {
                    event.preventDefault();
                    openDocument(rootDocument);
                  }}
                />
              )}
          </>
        ) : null}
        {error && !rootDocument ? (
          <SidebarLink
            to="/personal-notes"
            label="个人目录加载失败，点击检查"
          />
        ) : null}
      </Header>
    </Section>
  );
}

const Status = styled.div`
  padding: 4px 12px 6px;
  color: ${s("sidebarText")};
  font-size: 13px;
`;

export default observer(PersonalNotes);
