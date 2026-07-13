import { describe, it, expect } from "vitest";
import { buildGraphologyGraph, computeGraphMetrics } from "./graphologyGraph";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

const payload: AuditGraphPayload = {
  nodes: [
    {
      id: "home",
      url: "https://s.com/",
      title: "Home",
      statusCode: 200,
      wordCount: 9,
      internalLinkCount: 1,
      isIndexable: true,
      h1Count: 1,
      externalLinkCount: 0,
      canonicalUrl: null,
    },
    {
      id: "a",
      url: "https://s.com/a",
      title: "A",
      statusCode: 200,
      wordCount: 5,
      internalLinkCount: 0,
      isIndexable: true,
      h1Count: 1,
      externalLinkCount: 0,
      canonicalUrl: null,
    },
    {
      id: "orphan",
      url: "https://s.com/orphan",
      title: "O",
      statusCode: 200,
      wordCount: 5,
      internalLinkCount: 0,
      isIndexable: true,
      h1Count: 1,
      externalLinkCount: 0,
      canonicalUrl: null,
    },
  ],
  edges: [{ from: "home", to: "a", anchorText: "A", isBroken: false }],
  meta: {
    auditId: "a1",
    startUrl: "https://s.com/",
    pagesCrawled: 3,
    generatedAt: "x",
  },
};

describe("graphologyGraph", () => {
  it("builds a directed graph with all nodes and edges", () => {
    const g = buildGraphologyGraph(payload);
    expect(g.order).toBe(3);
    expect(g.size).toBe(1);
    expect(g.hasEdge("home", "a")).toBe(true);
  });
  it("detects orphan nodes (no inbound edges, excluding start)", () => {
    const g = buildGraphologyGraph(payload);
    const metrics = computeGraphMetrics(g, "home");
    expect(metrics.orphans).toEqual(["orphan"]);
    expect(metrics.depthByNode.get("a")).toBe(1);
  });
});
