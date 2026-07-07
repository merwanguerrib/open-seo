import { Copy, FileDown, Sheet, Swords, Tags, Trash2 } from "lucide-react";
import {
  TableBulkActionBar,
  TableBulkActionButton,
  TableBulkExportMenu,
} from "@/client/components/table/TableBulkActionBar";

export function SavedKeywordsBulkActionBar({
  selectedCount,
  onCopy,
  onOpenTags,
  onAnalyzeCompetitors,
  onExportCsv,
  onExportSheets,
  onDelete,
  onClear,
  exportingSelection,
}: {
  selectedCount: number;
  onCopy: () => void;
  onOpenTags: () => void;
  onAnalyzeCompetitors: () => void;
  onExportCsv: () => void;
  onExportSheets: () => void;
  onDelete: () => void;
  onClear: () => void;
  exportingSelection: "csv" | "sheets" | null;
}) {
  if (selectedCount === 0) return null;
  const exportBusy = exportingSelection != null;

  return (
    <TableBulkActionBar
      selectedCount={selectedCount}
      onClear={onClear}
      actions={
        <>
          <div className="flex items-center gap-0.5 px-1.5">
            <TableBulkActionButton
              icon={<Tags className="size-3.5" />}
              onClick={onOpenTags}
            >
              Tag
            </TableBulkActionButton>

            <TableBulkActionButton
              icon={<Swords className="size-3.5" />}
              onClick={onAnalyzeCompetitors}
            >
              Competitors
            </TableBulkActionButton>

            <TableBulkExportMenu
              busy={exportBusy}
              actions={[
                {
                  label: "Copy keywords",
                  icon: <Copy className="size-4" />,
                  onClick: onCopy,
                },
                {
                  label: "Export to Sheets",
                  icon: <Sheet className="size-4" />,
                  onClick: onExportSheets,
                },
                {
                  label: "Export CSV",
                  icon: <FileDown className="size-4" />,
                  onClick: onExportCsv,
                },
              ]}
            />
          </div>

          <div className="flex items-center border-l border-base-content/10 px-1.5">
            <TableBulkActionButton
              icon={<Trash2 className="size-3.5" />}
              onClick={onDelete}
              variant="danger"
            >
              Delete
            </TableBulkActionButton>
          </div>
        </>
      }
    />
  );
}
