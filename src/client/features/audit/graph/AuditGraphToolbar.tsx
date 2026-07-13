import type { RefObject } from "react";
import type { buildGraphSummary } from "@/client/features/audit/graph/graphSummary";

type GraphSummary = ReturnType<typeof buildGraphSummary>;

/** Crawl summary line plus the CSV/JSON/Graphify export and import controls. */
export function AuditGraphToolbar({
  summary,
  contentCaptured,
  isExportingGraphify,
  isImporting,
  fileInputRef,
  onExportCsv,
  onExportJson,
  onExportGraphify,
  onImportFile,
}: {
  summary: GraphSummary;
  contentCaptured: boolean;
  isExportingGraphify: boolean;
  isImporting: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onExportCsv: () => void;
  onExportJson: () => void;
  onExportGraphify: () => void;
  onImportFile: (file: File) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm text-base-content/70">
        {summary.pagesCrawled} pages &middot; {summary.orphanCount} orphan
        {summary.orphanCount === 1 ? "" : "s"} &middot; {summary.brokenCount}{" "}
        broken internal link{summary.brokenCount === 1 ? "" : "s"}
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={onExportCsv}
        >
          Export CSV
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={onExportJson}
        >
          Export JSON
        </button>
        <div
          className={contentCaptured ? "" : "tooltip tooltip-left"}
          data-tip="Re-run an audit with content capture enabled"
        >
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={!contentCaptured || isExportingGraphify}
            onClick={onExportGraphify}
          >
            Export for Graphify
          </button>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          disabled={isImporting}
          onClick={() => fileInputRef.current?.click()}
        >
          Import Graphify clusters
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onImportFile(file);
          }}
        />
      </div>
    </div>
  );
}
