import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { ListPlus, Sparkles, Swords, Upload, X } from "lucide-react";
import { toast } from "sonner";
import type { Workspace } from "@/client/features/content/contentStrategyTypes";
import {
  EmptyState,
  readTextFile,
} from "@/client/features/content/contentStrategyUi";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  dismissSuggestedKeywords,
  importContentKeywords,
  importSuggestedKeywords,
  runCompetitorDiscovery,
  runRelatedDiscovery,
} from "@/serverFunctions/contentStrategy";

export function ContentStrategyKeywordsTab({
  projectId,
  workspace,
  onChanged,
}: {
  projectId: string;
  workspace: Workspace;
  onChanged: () => void;
}) {
  const [content, setContent] = React.useState("");
  const [sourceName, setSourceName] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const importMutation = useMutation({
    mutationFn: () =>
      importContentKeywords({
        data: { projectId, content, sourceName },
      }),
    onSuccess: (result) => {
      setContent("");
      setSourceName(null);
      toast.success(
        `Imported ${result.imported} keywords and queued ${result.queued} new topics`,
      );
      onChanged();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Keyword import failed")),
  });

  const approvedKeywords = workspace.keywords.filter(
    (keyword) => keyword.status !== "suggested",
  );
  const suggestedKeywords = workspace.keywords.filter(
    (keyword) => keyword.status === "suggested",
  );

  const selectFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void readTextFile(file)
      .then((text) => {
        setContent(text);
        setSourceName(file.name);
      })
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error ? error.message : "File read failed",
        ),
      );
  };

  return (
    <div className="space-y-3">
      <div className="rounded-box border border-base-300 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">Import a keyword universe</h3>
            <p className="text-xs text-base-content/50">
              One keyword per line, or the first column of a CSV/TSV file.
              Imported keywords enter the Autopilot backlog immediately.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-4" />
            Choose file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,.tsv,text/plain,text/csv"
            className="hidden"
            onChange={selectFile}
          />
        </div>
        <textarea
          className="textarea textarea-bordered mt-3 min-h-28 w-full font-mono text-xs"
          placeholder={"keyword one\nkeyword two\nkeyword three"}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            if (!event.target.value) setSourceName(null);
          }}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-base-content/50">
            {sourceName ? `Source: ${sourceName}` : "Pasted keyword list"}
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!content.trim() || importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            <ListPlus className="size-4" />
            Import keywords
          </button>
        </div>
      </div>

      <SuggestionsSection
        projectId={projectId}
        suggestions={suggestedKeywords}
        onChanged={onChanged}
      />

      {approvedKeywords.length === 0 ? (
        <EmptyState
          icon={<ListPlus className="size-6" />}
          text="No approved keywords yet. Import a flat list or add a master plan."
        />
      ) : (
        <KeywordTable keywords={approvedKeywords} />
      )}
      {approvedKeywords.length > 200 && (
        <p className="text-xs text-base-content/50">
          Showing the first 200 of {approvedKeywords.length} keywords.
        </p>
      )}
    </div>
  );
}

function KeywordTable({ keywords }: { keywords: Workspace["keywords"] }) {
  return (
    <div className="overflow-x-auto rounded-box border border-base-300">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Keyword</th>
            <th>Role</th>
            <th>Cluster</th>
            <th>Priority</th>
            <th>Target URL</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {keywords.slice(0, 200).map((keyword) => (
            <tr key={keyword.id}>
              <td>
                <div className="font-medium">{keyword.keyword}</div>
                {keyword.intent && (
                  <div className="text-xs text-base-content/50">
                    {keyword.intent}
                  </div>
                )}
              </td>
              <td>
                <span className="badge badge-ghost badge-sm">
                  {keyword.role}
                </span>
              </td>
              <td className="max-w-52 truncate text-xs">
                {keyword.clusterName ?? "—"}
              </td>
              <td>{keyword.priority ?? "—"}</td>
              <td className="max-w-xs">
                {keyword.targetUrl ? (
                  <a
                    href={keyword.targetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="link block truncate font-mono text-xs"
                    title={keyword.targetUrl}
                  >
                    {keyword.targetUrl}
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td>
                <span
                  className={`badge badge-sm ${keyword.status === "covered" ? "badge-success" : "badge-outline"}`}
                >
                  {keyword.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SuggestionsSection({
  projectId,
  suggestions,
  onChanged,
}: {
  projectId: string;
  suggestions: Workspace["keywords"];
  onChanged: () => void;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const discoverCompetitors = useMutation({
    mutationFn: () => runCompetitorDiscovery({ data: { projectId } }),
    onSuccess: (result) => {
      toast.success(
        `Found ${result.suggested} competitor keyword suggestion${result.suggested !== 1 ? "s" : ""}`,
      );
      onChanged();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Competitor discovery failed")),
  });

  const discoverRelated = useMutation({
    mutationFn: () => runRelatedDiscovery({ data: { projectId } }),
    onSuccess: (result) => {
      toast.success(
        `Found ${result.suggested} related keyword suggestion${result.suggested !== 1 ? "s" : ""}`,
      );
      onChanged();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(error, "Related-keyword discovery failed"),
      ),
  });

  const importSelected = useMutation({
    mutationFn: (keywordIds: string[]) =>
      importSuggestedKeywords({ data: { projectId, keywordIds } }),
    onSuccess: (result) => {
      setSelected(new Set());
      toast.success(
        `Imported ${result.imported} keyword${result.imported !== 1 ? "s" : ""}, queued ${result.queued}`,
      );
      onChanged();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Import failed")),
  });

  const dismissSelected = useMutation({
    mutationFn: (keywordIds: string[]) =>
      dismissSuggestedKeywords({ data: { projectId, keywordIds } }),
    onSuccess: () => {
      setSelected(new Set());
      onChanged();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Dismiss failed")),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-2 rounded-box border border-base-300 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          Suggestions {suggestions.length > 0 ? `(${suggestions.length})` : ""}
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={discoverCompetitors.isPending}
            onClick={() => discoverCompetitors.mutate()}
          >
            <Swords className="size-4" />
            Discover from competitors
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={discoverRelated.isPending}
            onClick={() => discoverRelated.mutate()}
          >
            <Sparkles className="size-4" />
            Discover related keywords
          </button>
        </div>
      </div>

      {suggestions.length === 0 ? (
        <p className="text-xs text-base-content/50">
          No pending suggestions. Run a discovery above to find content gaps.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-box border border-base-300">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th />
                  <th>Keyword</th>
                  <th>Source</th>
                  <th>Volume</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((keyword) => (
                  <tr key={keyword.id}>
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={selected.has(keyword.id)}
                        onChange={() => toggle(keyword.id)}
                      />
                    </td>
                    <td className="font-medium">{keyword.keyword}</td>
                    <td className="max-w-52 truncate text-xs text-base-content/60">
                      {keyword.sourceName ?? keyword.source}
                    </td>
                    <td>{keyword.searchVolume ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={selected.size === 0 || importSelected.isPending}
              onClick={() => importSelected.mutate([...selected])}
            >
              Import selected ({selected.size})
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={selected.size === 0 || dismissSelected.isPending}
              onClick={() => dismissSelected.mutate([...selected])}
            >
              <X className="size-4" />
              Dismiss selected
            </button>
          </div>
        </>
      )}
    </div>
  );
}
