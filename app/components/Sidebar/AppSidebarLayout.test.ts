import { SidebarSection } from "@shared/types";
import { buildAppSidebarLayout } from "./AppSidebarLayout";

describe("buildAppSidebarLayout", () => {
  it("keeps personal notes and the other sections in one scrollable directory", () => {
    expect(
      buildAppSidebarLayout([
        SidebarSection.Collections,
        SidebarSection.Starred,
        SidebarSection.SharedWithMe,
      ])
    ).toEqual({
      items: [
        { kind: "personal-notes" },
        { kind: "section", section: SidebarSection.Collections },
        { kind: "section", section: SidebarSection.Starred },
        { kind: "section", section: SidebarSection.SharedWithMe },
      ],
    });
  });
});
