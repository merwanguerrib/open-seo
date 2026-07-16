import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildGraphifyZip } from "./graphifyZip";

describe("buildGraphifyZip", () => {
  it("zips every file under a graphify-input/ root", () => {
    const bytes = buildGraphifyZip([
      { path: "pages/index.md", content: "# home" },
      { path: "manifest.json", content: "{}" },
    ]);
    const unzipped = unzipSync(bytes);
    expect(Object.keys(unzipped).sort()).toEqual([
      "graphify-input/manifest.json",
      "graphify-input/pages/index.md",
    ]);
    expect(strFromU8(unzipped["graphify-input/pages/index.md"])).toBe("# home");
  });
});
