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
export function listCollections(scope = "default", force = false): Promise<CustomCollection[]> {
  return collectionCache(scope, async () => {
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
  }, force);
}

/** Share collection trees between custom scenes without crossing workspaces. */
export function collectionDocuments(
  collectionId: string, scope = "default", force = false
): Promise<CustomDocument[]> {
  return treeCache(`${scope}:${collectionId}`, async () => {
    const response = await client.post<{ data: CustomDocument[] }>(
      "/collections.documents", { id: collectionId }
    );
    return response.data ?? [];
  }, force);
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

