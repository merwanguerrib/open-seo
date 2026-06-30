import { describe, it, expect } from "vitest";
import { buildEdgeRows, resolveEdges } from "./graph-edges";
import type { StepPageResult } from "./types";

const page = (id: string, links: Array<[string, string | null]>) =>
  ({
    id,
    internalLinkDetails: links.map(([url, anchorText]) => ({ url, anchorText })),
  }) as unknown as StepPageResult;

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
