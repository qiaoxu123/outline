import type { SidebarSection } from "@shared/types";

export type ScrollableSidebarItem =
  | { kind: "personal-notes" }
  | {
      kind: "section";
      section: SidebarSection;
    };

export function buildAppSidebarLayout(sectionOrder: SidebarSection[]): {
  items: ScrollableSidebarItem[];
} {
  return {
    items: [
      { kind: "personal-notes" },
      ...sectionOrder.map((section) => ({
        kind: "section" as const,
        section,
      })),
    ],
  };
}
