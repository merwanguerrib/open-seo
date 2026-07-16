import { describe, it, expect } from "vitest";
import { computeAuditInsights } from "./auditInsights";
import { buildGraphologyGraph, computeGraphMetrics } from "./graphologyGraph";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

const node = (
  id: string,
  url: string,
  wordCount: number,
  statusCode = 200,
  isIndexable = true,
) => ({
  id,
  url,
  title: id,
  statusCode,
  wordCount,
  internalLinkCount: 0,
  isIndexable,
  h1Count: 1,
  externalLinkCount: 0,
  canonicalUrl: null,
});

const payload: AuditGraphPayload = {
  nodes: [
    node("home", "https://s.com/", 100),
    node("a", "https://s.com/a", 500),
    node("b", "https://s.com/b", 10),
    node("orphan", "https://s.com/orphan", 5),
    node("dead", "https://s.com/dead", 5, 404),
  ],
  edges: [
    { from: "home", to: "a", anchorText: "A", isBroken: false },
    { from: "home", to: "b", anchorText: "B", isBroken: false },
    { from: "a", to: "b", anchorText: "B2", isBroken: false },
    { from: "b", to: "dead", anchorText: "dead", isBroken: true },
  ],
  meta: {
    auditId: "x",
    startUrl: "https://s.com/",
    pagesCrawled: 5,
    generatedAt: "t",
  },
};

describe("computeAuditInsights", () => {
  const graph = buildGraphologyGraph(payload);
  const metrics = computeGraphMetrics(graph, "home");
  const insights = computeAuditInsights({ payload, graph, metrics });
  const byId = (id: string) => insights.find((i) => i.id === id);

  it("detects orphan pages (no inbound links, excluding start)", () => {
    expect(byId("orphans")?.nodeIds).toEqual(["orphan"]);
  });

  it("detects broken internal links and lists both endpoints", () => {
    const broken = byId("broken-internal-links");
    expect(broken?.nodeIds.sort()).toEqual(["b", "dead"]);
    expect(broken?.csvRows).toEqual([
      ["https://s.com/b", "https://s.com/dead", "dead"],
    ]);
  });

  it("omits insights with no affected nodes", () => {
    // No page is deeper than depth 3 in this fixture
    expect(byId("deep-pages")).toBeUndefined();
  });
});

describe("under-linked-rich-pages population filter", () => {
  // Fixture: a 404 page and a non-indexable page both have very high word counts
  // but must be excluded from the under-linked insight's candidate population.
  const nodes = [
    node("home", "https://s.com/", 100),
    node("rich-404", "https://s.com/rich-404", 9999, 404), // excluded: wrong status
    node("rich-noindex", "https://s.com/rich-noindex", 9999, 200, false), // excluded: not indexable
    node("a", "https://s.com/a", 500),
    node("b", "https://s.com/b", 50),
    node("c", "https://s.com/c", 30),
  ];
  const populationPayload: AuditGraphPayload = {
    nodes,
    edges: [
      { from: "home", to: "a", anchorText: "A", isBroken: false },
      { from: "home", to: "b", anchorText: "B", isBroken: false },
      { from: "home", to: "c", anchorText: "C", isBroken: false },
      { from: "a", to: "b", anchorText: "B2", isBroken: false },
      { from: "a", to: "c", anchorText: "C2", isBroken: false },
    ],
    meta: {
      auditId: "pop",
      startUrl: "https://s.com/",
      pagesCrawled: 6,
      generatedAt: "t",
    },
  };

  const graph = buildGraphologyGraph(populationPayload);
  const metrics = computeGraphMetrics(graph, "home");
  const insights = computeAuditInsights({
    payload: populationPayload,
    graph,
    metrics,
  });
  const byId = (id: string) => insights.find((i) => i.id === id);

  it("excludes the 404 page from under-linked-rich-pages nodeIds", () => {
    const insight = byId("under-linked-rich-pages");
    expect(insight?.nodeIds ?? []).not.toContain("rich-404");
  });

  it("excludes the non-indexable page from under-linked-rich-pages nodeIds", () => {
    const insight = byId("under-linked-rich-pages");
    expect(insight?.nodeIds ?? []).not.toContain("rich-noindex");
  });
});
