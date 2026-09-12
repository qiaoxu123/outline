import fs from "node:fs";
import path from "node:path";

describe("SidebarLink indentation", () => {
  it("supports an explicit icon inset before applying nesting depth", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "SidebarLink.tsx"),
      "utf8"
    );

    expect(source).toContain("iconIndentBase");
  });

  it("configures personal notes with a stable twelve pixel base inset", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "PersonalNotes.tsx"),
      "utf8"
    );

    expect(source).toContain("iconIndentBase={12}");
  });
});
