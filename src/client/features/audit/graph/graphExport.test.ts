import { describe, it, expect } from "vitest";
import {
  buildGraphExportRows,
  buildGraphExportJson,
  GRAPH_EXPORT_HEADERS,
} from "./graphExport";
import { buildGraphologyGraph, computeGraphMetrics } from "./graphologyGraph";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

const payload: AuditGraphPayload = {
  nodes: [
    {
      id: "home",
      url: "https://s.com/",
      title: "Home",
      statusCode: 200,
      wordCount: 50,
      internalLinkCount: 1,
      isIndexable: true,
      h1Count: 1,
      externalLinkCount: 4,
      canonicalUrl: "https://s.com/",
    },
    {
      id: "a",
      url: "https://s.com/blog/a",
      title: "A",
      statusCode: 200,
      wordCount: 30,
      internalLinkCount: 0,
      isIndexable: true,
      h1Count: 0,
      externalLinkCount: 2,
      canonicalUrl: null,
    },
  ],
  edges: [{ from: "home", to: "a", anchorText: "A", isBroken: false }],
  meta: {
    auditId: "x",
    startUrl: "https://s.com/",
    pagesCrawled: 2,
    generatedAt: "t",
  },
};

const graph = buildGraphologyGraph(payload);
const metrics = computeGraphMetrics(graph, "home");

describe("buildGraphExportRows", () => {
  it("exports one row per page with inbound/outbound/external links", () => {
    const { headers, rows } = buildGraphExportRows(payload, graph, metrics);
    expect(headers).toEqual(GRAPH_EXPORT_HEADERS);
    // Row for node "a": inbound=1 (home->a), outbound internal=0, external=2, category=blog
    const rowA = rows[1];
    expect(rowA[0]).toBe("https://s.com/blog/a"); // URL
    expect(rowA[2]).toBe("blog"); // Category
    expect(rowA[5]).toBe(1); // Inbound internal links (inDegree)
    expect(rowA[6]).toBe(0); // Outbound internal links
    expect(rowA[7]).toBe(2); // External links
  });
});

describe("buildGraphExportJson", () => {
  it("emits structured nodes with graph metrics plus edges", () => {
    const json = buildGraphExportJson(payload, graph, metrics);
    expect(json.edges).toEqual(payload.edges);
    const nodeA = json.nodes.find((n) => n.id === "a");
    expect(nodeA).toMatchObject({
      category: "blog",
      inbound: 1,
      outboundInternal: 0,
      externalLinks: 2,
      clickDepth: 1,
    });
  });
});
