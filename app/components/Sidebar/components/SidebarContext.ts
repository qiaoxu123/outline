import { createContext, useContext } from "react";
import type Document from "~/models/Document";
import type User from "~/models/User";

export type SidebarContextType =
  | "collections"
  | "shared"
  | "archive"
  | "personal-notes"
  | `group-${string}`
  | `starred-${string}`
  | undefined;

const SidebarContext = createContext<SidebarContextType>(undefined);

export const useSidebarContext = () => useContext(SidebarContext);

export const groupSidebarContext = (groupId: string): SidebarContextType =>
  `group-${groupId}`;

export const starredSidebarContext = (modelId: string): SidebarContextType =>
  `starred-${modelId}`;

export function activeDocumentIdForSidebarTree(
  activeDocumentId: string | undefined,
  activeContext: SidebarContextType,
  treeContext: SidebarContextType
): string | undefined {
  if (!activeDocumentId) {
    return undefined;
  }
  return activeContext === treeContext ||
    (!activeContext && treeContext === "collections")
    ? activeDocumentId
    : undefined;
}

export function isActiveInSidebarContext(
  pathMatches: boolean,
  activeContext: SidebarContextType,
  linkContext: SidebarContextType
): boolean {
  return pathMatches && activeContext === linkContext;
}

export const determineSidebarContext = ({
  document,
  user,
  currentContext,
}: {
  document: Document;
  user: User;
  currentContext?: SidebarContextType;
}): SidebarContextType => {
  const isStarred = document.isStarred || !!document.collection?.isStarred;
  const preferStarred = !currentContext || currentContext.startsWith("starred");

  if (isStarred && preferStarred) {
    const currentlyInStarredCollection =
      currentContext === starredSidebarContext(document.collectionId ?? "");

    return document.isStarred && !currentlyInStarredCollection
      ? starredSidebarContext(document.id)
      : starredSidebarContext(document.collectionId!);
  }

  if (document.collection) {
    return document.collection.isArchived ? "archive" : "collections";
  } else if (
    user.documentMemberships.find((m) => m.documentId === document.id)
  ) {
    return "shared";
  } else {
    const group = user.groupsWithDocumentMemberships.find(
      (g) => !!g.documentMemberships.find((m) => m.documentId === document.id)
    );
    return groupSidebarContext(group?.id ?? "");
  }
};

export default SidebarContext;
