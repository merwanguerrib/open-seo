import type { AuditGraphPayload } from "@/server/lib/audit/types";

export interface GraphSummary {
  pagesCrawled: number;
  orphanCount: number;
  brokenCount: number;
}

export function buildGraphSummary(
  payload: AuditGraphPayload,
  metrics: { orphans: string[] },
): GraphSummary {
  return {
    pagesCrawled: payload.meta.pagesCrawled,
    orphanCount: metrics.orphans.length,
    brokenCount: payload.edges.filter((e) => e.isBroken).length,
  };
}
