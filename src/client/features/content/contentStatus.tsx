type ContentArticleStatus =
  | "queued"
  | "generating"
  | "draft"
  | "published"
  | "failed"
  | "archived";

const STATUS_BADGES: Record<
  ContentArticleStatus,
  { label: string; className: string }
> = {
  queued: { label: "Queued", className: "badge-ghost" },
  generating: { label: "Generating", className: "badge-info" },
  draft: { label: "Draft", className: "badge-warning" },
  published: { label: "Published", className: "badge-success" },
  failed: { label: "Failed", className: "badge-error" },
  archived: { label: "Archived", className: "badge-ghost" },
};

export function ContentStatusBadge({
  status,
}: {
  status: ContentArticleStatus;
}) {
  const badge = STATUS_BADGES[status];
  return (
    <span className={`badge badge-sm ${badge.className}`}>
      {status === "generating" && (
        <span className="loading loading-spinner loading-xs" />
      )}
      {badge.label}
    </span>
  );
}

export function isArticleInProgress(status: ContentArticleStatus): boolean {
  return status === "queued" || status === "generating";
}
