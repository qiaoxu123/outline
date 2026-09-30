import { createWorkspaceReadCache } from "./WorkspaceRequests";
import { client } from "~/utils/ApiClient";

export type CustomDocument = {
  id: string;
  title: string;
  updatedAt?: string;
  createdAt?: string;
  collectionId?: string | null;
  parentDocumentId?: string | null;
  createdBy?: {
    id: string;
    name?: string;
    avatarUrl?: string | null;
  };
  text?: string;
  data?: unknown;
  urlId?: string;
  url?: string;
  children?: CustomDocument[];
};

export type CustomCollection = { id: string; name: string };

const collectionCache = createWorkspaceReadCache<CustomCollection[]>(60_000);
const treeCache = createWorkspaceReadCache<CustomDocument[]>(60_000);

/** Read every collection page, coalescing concurrent workspace discovery. */
export function listCollections(scope?: string, force = false): Promise<CustomCollection[]> {
  const load = async () => {
    const result: CustomCollection[] = [];
    for (let offset = 0; ; offset += 100) {
      const response = await client.post<{ data: CustomCollection[] }>(
        "/collections.list", { limit: 100, offset }
      );
      const page = response.data ?? [];
      result.push(...page);
      if (page.length < 100) {
        return result;
      }
    }
  };
  return scope ? collectionCache(scope, load, force) : load();
}

/** Share collection trees between custom scenes without crossing workspaces. */
export function collectionDocuments(
  collectionId: string, scope?: string, force = false
): Promise<CustomDocument[]> {
  const load = async () => {
    const response = await client.post<{ data: CustomDocument[] }>(
      "/collections.documents", { id: collectionId }
    );
    return response.data ?? [];
  };
  return scope ? treeCache(`${scope}:${collectionId}`, load, force) : load();
}

export function flattenDocuments(tree: CustomDocument[]): CustomDocument[] {
  const result: CustomDocument[] = [];
  const stack = [...tree];
  while (stack.length) {
    const document = stack.shift()!;
    result.push(document);
    stack.unshift(...(document.children ?? []));
  }
  return result;
}

export function findDocument(tree: CustomDocument[], title: string) {
  return flattenDocuments(tree).find(
    (document) => document.title.trim() === title
  );
}

