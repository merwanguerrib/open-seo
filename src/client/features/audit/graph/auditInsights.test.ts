import { describe, it, expect } from "vitest";
import { computeAuditInsights } from "./auditInsights";
import {
  buildGraphologyGraph,
  computeGraphMetrics,
} from "./graphologyGraph";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

const node = (
  id: string,
  url: string,
  wordCount: number,
  statusCode = 200,
) => ({
  id,
  url,
  title: id,
  statusCode,
  wordCount,
  internalLinkCount: 0,
  isIndexable: true,
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
  meta: { auditId: "x", startUrl: "https://s.com/", pagesCrawled: 5, generatedAt: "t" },
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
