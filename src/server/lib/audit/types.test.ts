import { describe, it, expect } from "vitest";
import { parseAuditConfig } from "./types";

describe("parseAuditConfig captureContent", () => {
  it("defaults captureContent to false when absent", () => {
    const cfg = parseAuditConfig(
      JSON.stringify({ maxPages: 50, lighthouseStrategy: "none" }),
    );
    expect(cfg?.captureContent).toBe(false);
  });
  it("preserves captureContent when present", () => {
    const cfg = parseAuditConfig(
      JSON.stringify({
        maxPages: 50,
        lighthouseStrategy: "none",
        captureContent: true,
      }),
    );
    expect(cfg?.captureContent).toBe(true);
  });
});
