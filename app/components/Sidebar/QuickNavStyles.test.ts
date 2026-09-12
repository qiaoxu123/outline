import fs from "node:fs";
import path from "node:path";

describe("quick navigation styles", () => {
  it("does not use a raised shadow for the selected icon", () => {
    const source = fs.readFileSync(path.join(__dirname, "App.tsx"), "utf8");

    expect(source).not.toContain("box-shadow: 0 2px 8px");
  });
});
