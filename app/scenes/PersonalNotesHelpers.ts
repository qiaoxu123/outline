import type { CustomDocument } from "./customData";

/** The dedicated collection belongs in the personal-notes sidebar on desktop. */
export function isPersonalNotesCollectionName(name: string): boolean {
  return name.trim().toLocaleLowerCase("en") === "personal";
}

export type PersonalRoot = {
  docId: string;
  collectionId: string;
};

export type PersonalDirectoryParams = {
  parentDocumentId: string;
  sort: "title";
  direction: "ASC";
  limit: 100;
  offset: number;
};

export function buildPersonalDirectoryParams(
  root: PersonalRoot,
  parentDocumentId = root.docId,
  offset = 0
): PersonalDirectoryParams {
  return {
    parentDocumentId,
    sort: "title",
    direction: "ASC",
    limit: 100,
    offset,
  };
}

export function selectPersonalDirectoryDocuments(
  documents: CustomDocument[],
  root: PersonalRoot,
  parentDocumentId = root.docId
): CustomDocument[] {
  return documents.filter(
    (document) =>
      document.collectionId === root.collectionId &&
      document.parentDocumentId === parentDocumentId
  );
}

export function parseDocumentInfoResult(value: unknown): CustomDocument | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const result = value as {
    ok?: unknown;
    data?: { document?: unknown };
  };
  const document = result.data?.document;
  if (
    result.ok !== true ||
    !document ||
    typeof document !== "object" ||
    typeof (document as CustomDocument).id !== "string" ||
    typeof (document as CustomDocument).title !== "string"
  ) {
    return null;
  }
  return document as CustomDocument;
}

const titleCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

function leadingNumber(title: string): number | null {
  const match = /^\s*(\d+)(?:[.、\s]|$)/.exec(title);
  return match ? Number(match[1]) : null;
}

export function sortPersonalDocuments<T extends Pick<CustomDocument, "title">>(
  documents: T[]
): T[] {
  return [...documents].sort((left, right) => {
    const leftNumber = leadingNumber(left.title);
    const rightNumber = leadingNumber(right.title);
    if (leftNumber !== null && rightNumber === null) {
      return -1;
    }
    if (leftNumber === null && rightNumber !== null) {
      return 1;
    }
    if (
      leftNumber !== null &&
      rightNumber !== null &&
      leftNumber !== rightNumber
    ) {
      return leftNumber - rightNumber;
    }
    return titleCollator.compare(left.title.trim(), right.title.trim());
  });
}

export function findPersonalRoot(
  tree: CustomDocument[],
  userName: string
): CustomDocument | undefined {
  const target = userName.trim();
  if (!target) {
    return undefined;
  }

  const pending = [...tree];
  while (pending.length) {
    const document = pending.shift()!;
    if (document.title.trim() === target) {
      return document;
    }
    pending.unshift(...(document.children ?? []));
  }
  return undefined;
}

export function parsePersonalRootResult(value: unknown): PersonalRoot | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const result = value as {
    ok?: unknown;
    data?: { docId?: unknown; collectionId?: unknown } | null;
  };
  if (
    result.ok !== true ||
    !result.data ||
    typeof result.data.docId !== "string" ||
    typeof result.data.collectionId !== "string" ||
    !result.data.docId ||
    !result.data.collectionId
  ) {
    return null;
  }
  return {
    docId: result.data.docId,
    collectionId: result.data.collectionId,
  };
}
