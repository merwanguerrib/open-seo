import type { NodeDetail } from "@/client/features/audit/graph/nodeDetail";

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-base-content/60">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function AuditNodeDetailPanel({
  detail,
  onClose,
}: {
  detail: NodeDetail | null;
  onClose: () => void;
}) {
  if (!detail) {
    return (
      <div className="rounded-lg border border-base-300 p-4 text-sm text-base-content/50">
        Click a node to inspect it.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-base-300 p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="font-semibold">{detail.title ?? "Untitled"}</div>
        <button
          type="button"
          aria-label="Close node detail"
          className="btn btn-ghost btn-xs"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <a
        href={detail.url}
        target="_blank"
        rel="noreferrer"
        className="block break-all text-xs text-primary hover:underline"
      >
        {detail.url}
      </a>
      <div className="mt-3 divide-y divide-base-200">
        <Row label="HTTP status" value={detail.statusCode ?? "Unknown"} />
        <Row label="Indexable" value={detail.isIndexable ? "Yes" : "No"} />
        <Row label="Inbound internal links" value={detail.inbound} />
        <Row label="Outbound internal links" value={detail.outboundInternal} />
        <Row label="External links" value={detail.externalLinks} />
        <Row label="H1 count" value={detail.h1Count} />
        <Row label="Click depth" value={detail.clickDepth ?? "Unreachable"} />
        <Row label="Internal PageRank" value={detail.pagerank.toFixed(4)} />
        <Row label="Canonical" value={detail.canonicalUrl ?? "Not set"} />
      </div>
    </div>
  );
}
