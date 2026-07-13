import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  buildGraphologyGraph,
  computeGraphMetrics,
} from "@/client/features/audit/graph/graphologyGraph";
import {
  buildGraphExportRows,
  buildGraphExportJson,
} from "@/client/features/audit/graph/graphExport";
import { buildCsv, downloadCsv, downloadJson } from "@/client/lib/csv";
import {
  buildGraphifyZip,
  downloadZip,
} from "@/client/features/audit/graph/graphifyZip";
import {
  exportAuditForGraphify,
  importGraphifyClusters,
} from "@/serverFunctions/audit";
import type { AuditGraphPayload } from "@/server/lib/audit/types";

type AuditGraph = ReturnType<typeof buildGraphologyGraph>;
type GraphMetrics = ReturnType<typeof computeGraphMetrics>;

/**
 * CSV/JSON/Graphify export and Graphify-cluster import for the audit graph,
 * bundling the async state (in-flight flags, file input ref) they need.
 */
export function useAuditGraphActions(input: {
  payload: AuditGraphPayload;
  projectId: string;
  graph: AuditGraph;
  metrics: GraphMetrics;
  onImported: () => void;
}) {
  const { payload, projectId, graph, metrics, onImported } = input;
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExportingGraphify, setIsExportingGraphify] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const contentCaptured = payload.meta.contentCaptured === true;

  const exportCsv = () => {
    const { headers, rows } = buildGraphExportRows(payload, graph, metrics);
    downloadCsv("audit-graph.csv", buildCsv(headers, rows));
  };

  const exportJson = () => {
    downloadJson(
      "audit-graph.json",
      buildGraphExportJson(payload, graph, metrics),
    );
  };

  const onImportFile = async (file: File) => {
    setIsImporting(true);
    try {
      const graphJson: unknown = JSON.parse(await file.text());
      const { imported } = await importGraphifyClusters({
        data: { projectId, auditId: payload.meta.auditId, graphJson },
      });
      toast.success(`Imported semantic clusters for ${imported} pages.`);
      await queryClient.invalidateQueries({ queryKey: ["audit-graph"] });
      onImported();
    } catch (error) {
      toast.error(
        error instanceof SyntaxError
          ? "That file is not valid JSON."
          : "Import failed. Use the graph.json produced by graphify on this audit's export.",
      );
    } finally {
      setIsImporting(false);
    }
  };

  const exportGraphify = async () => {
    setIsExportingGraphify(true);
    try {
      const { files } = await exportAuditForGraphify({
        data: { projectId, auditId: payload.meta.auditId },
      });
      downloadZip("graphify-input.zip", buildGraphifyZip(files));
    } catch {
      toast.error(
        "Graphify export failed. Try re-running the audit with content capture enabled.",
      );
    } finally {
      setIsExportingGraphify(false);
    }
  };

  return {
    fileInputRef,
    contentCaptured,
    isExportingGraphify,
    isImporting,
    exportCsv,
    exportJson,
    onImportFile,
    exportGraphify,
  };
}
