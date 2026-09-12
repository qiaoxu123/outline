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

export async function listCollections(): Promise<CustomCollection[]> {
  const response = await client.post<{ data: CustomCollection[] }>(
    "/collections.list",
    {}
  );
  return response.data ?? [];
}

export async function collectionDocuments(
  collectionId: string
): Promise<CustomDocument[]> {
  const response = await client.post<{ data: CustomDocument[] }>(
    "/collections.documents",
    { id: collectionId }
  );
  return response.data ?? [];
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
