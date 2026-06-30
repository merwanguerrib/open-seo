import { describe, it, expect } from "vitest";
import { buildGraphSummary } from "./graphSummary";
import { buildGraphologyGraph, computeGraphMetrics } from "./graphologyGraph";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

const payload: AuditGraphPayload = {
  nodes: [
    { id: "home", url: "https://s.com/", title: "Home", statusCode: 200, wordCount: 9, internalLinkCount: 1, isIndexable: true },
    { id: "orphan", url: "https://s.com/o", title: "O", statusCode: 200, wordCount: 1, internalLinkCount: 0, isIndexable: true },
  ],
  edges: [{ from: "home", to: "orphan", anchorText: null, isBroken: true }],
  meta: { auditId: "a1", startUrl: "https://s.com/", pagesCrawled: 2, generatedAt: "x" },
};

describe("buildGraphSummary", () => {
  it("counts pages, orphans, and broken links", () => {
    const graph = buildGraphologyGraph(payload);
    const metrics = computeGraphMetrics(graph, "home");
    expect(buildGraphSummary(payload, metrics)).toEqual({
      pagesCrawled: 2,
      orphanCount: 0, // 'orphan' now has an inbound edge
      brokenCount: 1,
    });
  });
});
