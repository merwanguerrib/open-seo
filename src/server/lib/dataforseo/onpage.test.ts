import { describe, expect, it } from "vitest";
import { extractParsedPageText } from "./onpage";

// The SDK deserializes results into class instances, not plain objects — the
// extractor must handle those (a zod object/record schema does not).
class FakeSdkModel {
  [key: string]: unknown;
  constructor(data: Record<string, unknown>) {
    Object.assign(this, data);
  }
}

describe("extractParsedPageText", () => {
  it("prefers page_as_markdown when present", () => {
    const items = [
      new FakeSdkModel({
        type: "content_parsing_element",
        page_as_markdown: "# Title\n\nBody text.",
        page_content: new FakeSdkModel({
          main_topic: [new FakeSdkModel({ h_title: "Ignored" })],
        }),
      }),
    ];
    expect(extractParsedPageText(items)).toBe("# Title\n\nBody text.");
  });

  it("falls back to walking page_content h_title/text leaves, skipping header/footer", () => {
    const items = [
      new FakeSdkModel({
        page_content: new FakeSdkModel({
          header: new FakeSdkModel({ text: "Nav boilerplate" }),
          main_topic: [
            new FakeSdkModel({
              h_title: "Main heading",
              primary_content: [new FakeSdkModel({ text: "First paragraph." })],
            }),
          ],
          footer: new FakeSdkModel({ text: "Footer boilerplate" }),
        }),
      }),
    ];
    const text = extractParsedPageText(items);
    expect(text).toContain("Main heading");
    expect(text).toContain("First paragraph.");
    expect(text).not.toContain("boilerplate");
  });

  it("returns empty string for missing or non-array items", () => {
    expect(extractParsedPageText(undefined)).toBe("");
    expect(extractParsedPageText([])).toBe("");
  });
});
