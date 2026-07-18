import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Globe2, ListPlus } from "lucide-react";
import { toast } from "sonner";
import {
  parseContentType,
  type ContentType,
  type Workspace,
} from "@/client/features/content/contentStrategyTypes";
import {
  EmptyState,
  HealthBadge,
} from "@/client/features/content/contentStrategyUi";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { importContentUrls } from "@/serverFunctions/contentStrategy";

export function ContentStrategyInventoryTab({
  projectId,
  workspace,
  onChanged,
}: {
  projectId: string;
  workspace: Workspace;
  onChanged: () => void;
}) {
  const [contentType, setContentType] = React.useState<ContentType>("blog");
  const [urls, setUrls] = React.useState("");
  const importMutation = useMutation({
    mutationFn: () =>
      importContentUrls({
        data: { projectId, contentType, content: urls },
      }),
    onSuccess: (result) => {
      setUrls("");
      toast.success(`Added ${result.imported} URLs to the content inventory`);
      onChanged();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "URL import failed")),
  });

  return (
    <div className="space-y-3">
      <details className="collapse-arrow collapse border border-base-300">
        <summary className="collapse-title min-h-0 py-3 text-sm font-medium">
          Add or classify blog, pillar, product, or other URLs
        </summary>
        <div className="collapse-content">
          <div className="grid gap-2 md:grid-cols-[10rem_1fr_auto]">
            <select
              className="select select-bordered select-sm"
              value={contentType}
              onChange={(event) => {
                const next = parseContentType(event.target.value);
                if (next) setContentType(next);
              }}
            >
              <option value="blog">Blog article</option>
              <option value="pillar">Pillar page</option>
              <option value="product">Product page</option>
              <option value="other">Other</option>
            </select>
            <textarea
              className="textarea textarea-bordered textarea-sm min-h-20 font-mono text-xs"
              placeholder={
                "https://example.com/blog/article-one\n/guide/pillar-page"
              }
              value={urls}
              onChange={(event) => setUrls(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={!urls.trim() || importMutation.isPending}
              onClick={() => importMutation.mutate()}
            >
              <ListPlus className="size-4" />
              Add URLs
            </button>
          </div>
          <p className="mt-2 text-xs text-base-content/50">
            Site Audit supplies health metrics. Manual classification always
            wins over URL heuristics.{" "}
            <Link
              to="/p/$projectId/audit"
              params={{ projectId }}
              className="link"
            >
              Open Site Audit
            </Link>
          </p>
        </div>
      </details>

      {workspace.assets.length === 0 ? (
        <EmptyState
          icon={<Globe2 className="size-6" />}
          text="No content URLs yet. Analyze the latest site audit or add URLs manually."
        />
      ) : (
        <InventoryTable workspace={workspace} />
      )}
      {workspace.assets.length > 150 && (
        <p className="text-xs text-base-content/50">
          Showing the first 150 of {workspace.assets.length} URLs.
        </p>
      )}
    </div>
  );
}

function InventoryTable({ workspace }: { workspace: Workspace }) {
  return (
    <div className="overflow-x-auto rounded-box border border-base-300">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Type</th>
            <th>URL</th>
            <th>Target keyword</th>
            <th>State</th>
            <th>Health</th>
            <th className="text-right">Words</th>
          </tr>
        </thead>
        <tbody>
          {workspace.assets.slice(0, 150).map((asset) => (
            <tr key={asset.id}>
              <td>
                <span className="badge badge-ghost badge-sm">
                  {asset.contentType}
                </span>
              </td>
              <td className="max-w-md">
                <a
                  href={asset.url}
                  target="_blank"
                  rel="noreferrer"
                  className="link block truncate font-mono text-xs"
                  title={asset.url}
                >
                  {asset.url}
                </a>
                {asset.title && (
                  <div className="truncate text-xs text-base-content/50">
                    {asset.title}
                  </div>
                )}
              </td>
              <td className="text-xs">{asset.targetKeyword ?? "—"}</td>
              <td>
                <span
                  className={`badge badge-sm ${asset.state === "existing" ? "badge-success" : "badge-outline"}`}
                >
                  {asset.state}
                </span>
              </td>
              <td>
                <HealthBadge health={asset.health} />
              </td>
              <td className="text-right tabular-nums">
                {asset.wordCount ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
