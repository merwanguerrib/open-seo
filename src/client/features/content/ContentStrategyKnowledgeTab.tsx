import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  parseDocumentFormat,
  parseDocumentKind,
  type DocumentFormat,
  type DocumentKind,
  type Workspace,
} from "@/client/features/content/contentStrategyTypes";
import {
  documentKindLabel,
  EmptyState,
  formatFromFilename,
  formatSize,
  kindFromFilename,
  readTextFile,
} from "@/client/features/content/contentStrategyUi";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  deleteContentDocument,
  saveContentDocument,
} from "@/serverFunctions/contentStrategy";

export function ContentStrategyKnowledgeTab({
  projectId,
  workspace,
  onChanged,
}: {
  projectId: string;
  workspace: Workspace;
  onChanged: () => void;
}) {
  const [kind, setKind] = React.useState<DocumentKind>("master_plan");
  const [name, setName] = React.useState("");
  const [format, setFormat] = React.useState<DocumentFormat>("json");
  const [content, setContent] = React.useState("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const saveMutation = useSaveDocument({
    projectId,
    kind,
    name,
    format,
    content,
    reset: () => {
      setName("");
      setContent("");
    },
    onChanged,
  });
  const uploadMutation = useUploadDocuments(projectId, onChanged);
  const deleteMutation = useDeleteDocument(projectId, onChanged);

  const selectKind = (value: string) => {
    const nextKind = parseDocumentKind(value);
    if (!nextKind) return;
    setKind(nextKind);
    if (nextKind !== "master_plan" && format === "json") {
      setFormat("markdown");
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
      <div className="rounded-box border border-base-300 p-3">
        <KnowledgeHeader
          isUploading={uploadMutation.isPending}
          fileInputRef={fileInputRef}
          onFiles={(files) => uploadMutation.mutate(files)}
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <label className="form-control">
            <span className="label-text text-xs">Document type</span>
            <select
              className="select select-bordered select-sm"
              value={kind}
              onChange={(event) => selectKind(event.target.value)}
            >
              <option value="master_plan">Master plan</option>
              <option value="editorial_guidelines">Editorial guidelines</option>
              <option value="agent_instructions">Agent instructions</option>
              <option value="quality_rubric">Quality rubric</option>
              <option value="reference">Reference</option>
            </select>
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Format</span>
            <select
              className="select select-bordered select-sm"
              value={format}
              onChange={(event) => {
                const nextFormat = parseDocumentFormat(event.target.value);
                if (nextFormat) setFormat(nextFormat);
              }}
            >
              <option value="json">JSON</option>
              <option value="markdown">Markdown</option>
              <option value="text">Plain text</option>
            </select>
          </label>
          <label className="form-control sm:col-span-2">
            <span className="label-text text-xs">Name</span>
            <input
              className="input input-bordered input-sm"
              placeholder="master-plan.json"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </div>
        <textarea
          className="textarea textarea-bordered mt-2 min-h-48 w-full font-mono text-xs"
          placeholder="Paste a master plan, editorial policy, agent instructions, or quality rubric…"
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!name.trim() || !content.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            <FileText className="size-4" />
            Save document
          </button>
        </div>
      </div>

      <DocumentList
        workspace={workspace}
        isDeleting={deleteMutation.isPending}
        onDelete={(documentId) => deleteMutation.mutate(documentId)}
      />
    </div>
  );
}

function KnowledgeHeader({
  isUploading,
  fileInputRef,
  onFiles,
}: {
  isUploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: File[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-medium">Add context for the agents</h3>
        <p className="text-xs text-base-content/50">
          Master plan JSON is parsed into clusters, keywords, roles, and target
          URLs. Markdown and text files guide briefs and writing.
        </p>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={isUploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {isUploading ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          <Upload className="size-4" />
        )}
        Upload documents
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".json,.md,.markdown,.txt,application/json,text/plain,text/markdown"
        className="hidden"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </div>
  );
}

function DocumentList({
  workspace,
  isDeleting,
  onDelete,
}: {
  workspace: Workspace;
  isDeleting: boolean;
  onDelete: (documentId: string) => void;
}) {
  return (
    <div className="rounded-box border border-base-300 p-3">
      <h3 className="text-sm font-medium">Attached documents</h3>
      <p className="text-xs text-base-content/50">
        These become durable context for article planning and generation.
      </p>
      <div className="mt-3 space-y-2">
        {workspace.documents.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-6" />}
            text="No agent context attached yet."
          />
        ) : (
          workspace.documents.map((document) => (
            <div
              key={document.id}
              className="flex items-start justify-between gap-2 rounded-box bg-base-200 p-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {document.name}
                </div>
                <div className="text-xs text-base-content/50">
                  {documentKindLabel(document.kind)} ·{" "}
                  {formatSize(document.size)}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-base-content/60">
                  {document.preview}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-xs text-error"
                title="Remove document"
                disabled={isDeleting}
                onClick={() => onDelete(document.id)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function useSaveDocument({
  projectId,
  kind,
  name,
  format,
  content,
  reset,
  onChanged,
}: {
  projectId: string;
  kind: DocumentKind;
  name: string;
  format: DocumentFormat;
  content: string;
  reset: () => void;
  onChanged: () => void;
}) {
  return useMutation({
    mutationFn: () =>
      saveContentDocument({
        data: { projectId, kind, name, format, content },
      }),
    onSuccess: (result) => {
      reset();
      toast.success(
        result.importedKeywords > 0
          ? `Saved document, imported ${result.importedKeywords} planned keywords and queued ${result.queued}`
          : "Saved agent document",
      );
      onChanged();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Document import failed")),
  });
}

function useUploadDocuments(projectId: string, onChanged: () => void) {
  return useMutation({
    mutationFn: async (files: File[]) => {
      let importedKeywords = 0;
      let queued = 0;
      for (const file of files) {
        const result = await saveContentDocument({
          data: {
            projectId,
            kind: kindFromFilename(file.name),
            name: file.name,
            format: formatFromFilename(file.name),
            content: await readTextFile(file),
          },
        });
        importedKeywords += result.importedKeywords;
        queued += result.queued;
      }
      return { files: files.length, importedKeywords, queued };
    },
    onSuccess: (result) => {
      toast.success(
        result.importedKeywords > 0
          ? `Uploaded ${result.files} documents, imported ${result.importedKeywords} planned keywords and queued ${result.queued}`
          : `Uploaded ${result.files} agent document${result.files === 1 ? "" : "s"}`,
      );
      onChanged();
    },
    onError: (error) => {
      toast.error(getStandardErrorMessage(error, "Document upload failed"));
      onChanged();
    },
  });
}

function useDeleteDocument(projectId: string, onChanged: () => void) {
  return useMutation({
    mutationFn: (documentId: string) =>
      deleteContentDocument({ data: { projectId, documentId } }),
    onSuccess: () => {
      toast.success("Document removed");
      onChanged();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Delete failed")),
  });
}
