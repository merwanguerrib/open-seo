import { describe, it, expect } from "vitest";
import { buildNodeDetail } from "./nodeDetail";
import { buildGraphologyGraph, computeGraphMetrics } from "./graphologyGraph";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

const payload: AuditGraphPayload = {
  nodes: [
    { id: "home", url: "https://s.com/", title: "Home", statusCode: 200, wordCount: 50, internalLinkCount: 2, isIndexable: true, h1Count: 1, externalLinkCount: 4, canonicalUrl: "https://s.com/" },
    { id: "a", url: "https://s.com/a", title: "A", statusCode: 200, wordCount: 30, internalLinkCount: 0, isIndexable: true, h1Count: 0, externalLinkCount: 1, canonicalUrl: null },
  ],
  edges: [{ from: "home", to: "a", anchorText: "A", isBroken: false }],
  meta: { auditId: "x", startUrl: "https://s.com/", pagesCrawled: 2, generatedAt: "t" },
};

describe("buildNodeDetail", () => {
  const graph = buildGraphologyGraph(payload);
  const metrics = computeGraphMetrics(graph, "home");

  it("derives inbound (inDegree), outbound, and page fields", () => {
    const detail = buildNodeDetail(payload, graph, metrics, "a");
    expect(detail).toMatchObject({
      url: "https://s.com/a",
      inbound: 1,
      outboundInternal: 0,
      externalLinks: 1,
      h1Count: 0,
      canonicalUrl: null,
      clickDepth: 1,
    });
  });

  it("returns null for an unknown node id", () => {
    expect(buildNodeDetail(payload, graph, metrics, "nope")).toBeNull();
  });
});
