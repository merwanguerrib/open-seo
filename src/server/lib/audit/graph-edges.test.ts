import { describe, it, expect } from "vitest";
import {
  buildEdgeRows,
  resolveEdges,
  buildAuditGraphPayload,
} from "./graph-edges";
import type { CrawledPageResult } from "./types";

const page = (id: string, links: Array<[string, string | null]>) =>
  ({
    id,
    internalLinkDetails: links.map(([url, anchorText]) => ({
      url,
      anchorText,
    })),
  }) as unknown as CrawledPageResult;

describe("buildEdgeRows", () => {
  it("dedupes per (fromPageId, toUrl) and builds deterministic ids", () => {
    const rows = buildEdgeRows("audit-1", [
      page("p1", [
        ["https://s.com/a", "A"],
        ["https://s.com/a", "A again"],
        ["https://s.com/b", null],
      ]),
    ]);
    expect(rows).toEqual([
      {
        id: "audit_page_links:p1:https://s.com/a",
        auditId: "audit-1",
        fromPageId: "p1",
        toUrl: "https://s.com/a",
        anchorText: "A",
      },
      {
        id: "audit_page_links:p1:https://s.com/b",
        auditId: "audit-1",
        fromPageId: "p1",
        toUrl: "https://s.com/b",
        anchorText: null,
      },
    ]);
  });
});

describe("resolveEdges", () => {
  it("links toPageId by url and flags broken targets", () => {
    const pages = [
      { id: "p1", url: "https://s.com/a", statusCode: 200 },
      { id: "p2", url: "https://s.com/b", statusCode: 404 },
    ];
    const edges = [
      { id: "e1", toUrl: "https://s.com/a" },
      { id: "e2", toUrl: "https://s.com/b" },
      { id: "e3", toUrl: "https://s.com/missing" },
    ];
    expect(resolveEdges(edges, pages)).toEqual([
      { id: "e1", toPageId: "p1", isBroken: false },
      { id: "e2", toPageId: "p2", isBroken: true },
      { id: "e3", toPageId: null, isBroken: false },
    ]);
  });
});

describe("buildAuditGraphPayload", () => {
  it("maps pages to nodes and resolved edges to edges (skipping unresolved)", () => {
    const payload = buildAuditGraphPayload({
      auditId: "a1",
      startUrl: "https://s.com/",
      pages: [
        {
          id: "p1",
          url: "https://s.com/",
          title: "Home",
          statusCode: 200,
          wordCount: 10,
          internalLinkCount: 1,
          isIndexable: true,
          h1Count: 1,
          externalLinkCount: 0,
          canonicalUrl: null,
        },
        {
          id: "p2",
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
      ],
      edges: [
        { fromPageId: "p1", toPageId: "p2", anchorText: "A", isBroken: false },
        { fromPageId: "p1", toPageId: null, anchorText: null, isBroken: false },
      ],
    });
    expect(payload.nodes).toHaveLength(2);
    expect(payload.edges).toEqual([
      { from: "p1", to: "p2", anchorText: "A", isBroken: false },
    ]);
    expect(payload.meta.pagesCrawled).toBe(2);
  });

  it("passes h1Count, externalLinkCount, canonicalUrl through to nodes", () => {
    const payload = buildAuditGraphPayload({
      auditId: "a1",
      startUrl: "https://s.com/",
      pages: [
        {
          id: "p1",
          url: "https://s.com/",
          title: "Home",
          statusCode: 200,
          wordCount: 10,
          internalLinkCount: 1,
          isIndexable: true,
          h1Count: 2,
          externalLinkCount: 3,
          canonicalUrl: "https://s.com/",
        },
      ],
      edges: [],
    });
    expect(payload.nodes[0]).toMatchObject({
      h1Count: 2,
      externalLinkCount: 3,
      canonicalUrl: "https://s.com/",
    });
  });

  it("attaches semantic cluster labels to nodes when clusters are provided", () => {
    const page = {
      id: "p1",
      url: "https://s.com/",
      title: "Home",
      statusCode: 200,
      wordCount: 10,
      internalLinkCount: 0,
      isIndexable: true,
      h1Count: 1,
      externalLinkCount: 0,
      canonicalUrl: null,
    };
    const payload = buildAuditGraphPayload({
      auditId: "a",
      startUrl: "https://s.com/",
      pages: [page, { ...page, id: "p2", url: "https://s.com/b" }],
      edges: [],
      clusters: [{ pageId: "p1", clusterLabel: "Docs" }],
    });
    expect(payload.nodes.find((n) => n.id === "p1")?.semanticCluster).toBe(
      "Docs",
    );
    expect(
      payload.nodes.find((n) => n.id === "p2")?.semanticCluster,
    ).toBeNull();
  });

  it("carries contentCaptured into the payload meta", () => {
    const payload = buildAuditGraphPayload({
      auditId: "a",
      startUrl: "https://s.com/",
      pages: [],
      edges: [],
      contentCaptured: true,
    });
    expect(payload.meta.contentCaptured).toBe(true);
  });
});
