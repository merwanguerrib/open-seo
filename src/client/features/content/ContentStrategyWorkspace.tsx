import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ContentStrategyInventoryTab } from "@/client/features/content/ContentStrategyInventoryTab";
import { ContentStrategyKeywordsTab } from "@/client/features/content/ContentStrategyKeywordsTab";
import { ContentStrategyKnowledgeTab } from "@/client/features/content/ContentStrategyKnowledgeTab";
import type {
  Workspace,
  WorkspaceTab,
} from "@/client/features/content/contentStrategyTypes";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  analyzeExistingContent,
  getContentStrategyWorkspace,
} from "@/serverFunctions/contentStrategy";

export function ContentStrategyWorkspace({
  projectId,
  onChanged,
}: {
  projectId: string;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<WorkspaceTab>("inventory");
  const workspaceQuery = useQuery({
    queryKey: ["content-strategy", projectId],
    queryFn: () => getContentStrategyWorkspace({ data: { projectId } }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: ["content-strategy", projectId],
    });
    onChanged();
  };
  const analyzeMutation = useMutation({
    mutationFn: () => analyzeExistingContent({ data: { projectId } }),
    onSuccess: (result) => {
      if (result.status === "no_audit") {
        toast.warning("Run a site audit first, then analyze existing content.");
      } else {
        toast.success(
          `Analyzed ${result.analyzed} pages and matched ${result.coveredKeywords} planned keywords`,
        );
      }
      refresh();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Content analysis failed")),
  });

  return (
    <div className="card border border-base-300 bg-base-100">
      <div className="card-body gap-4 p-4">
        <WorkspaceHeader
          isAnalyzing={analyzeMutation.isPending}
          onAnalyze={() => analyzeMutation.mutate()}
        />
        {workspaceQuery.isError ? (
          <div className="rounded-box border border-error/30 bg-error/5 p-4 text-sm">
            <p>
              {getStandardErrorMessage(
                workspaceQuery.error,
                "Could not load the content strategy workspace",
              )}
            </p>
            <button
              type="button"
              className="btn btn-sm mt-3"
              onClick={() => void workspaceQuery.refetch()}
            >
              Retry
            </button>
          </div>
        ) : workspaceQuery.data ? (
          <WorkspaceContent
            projectId={projectId}
            workspace={workspaceQuery.data}
            tab={tab}
            setTab={setTab}
            onChanged={refresh}
          />
        ) : (
          <div className="flex justify-center py-8">
            <span className="loading loading-spinner loading-md" />
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceHeader({
  isAnalyzing,
  onAnalyze,
}: {
  isAnalyzing: boolean;
  onAnalyze: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-primary" />
          <h2 className="font-medium">Content strategy workspace</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-base-content/60">
          Give Autopilot your existing content, approved keywords, target URLs,
          master plans, and editorial instructions. This context is used to
          avoid cannibalization and guide every generated article.
        </p>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={isAnalyzing}
        onClick={onAnalyze}
      >
        {isAnalyzing ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        Analyze existing content
      </button>
    </div>
  );
}

function WorkspaceContent({
  projectId,
  workspace,
  tab,
  setTab,
  onChanged,
}: {
  projectId: string;
  workspace: Workspace;
  tab: WorkspaceTab;
  setTab: (tab: WorkspaceTab) => void;
  onChanged: () => void;
}) {
  return (
    <>
      <WorkspaceSummary workspace={workspace} />
      <WorkspaceTabs tab={tab} setTab={setTab} />
      {tab === "inventory" && (
        <ContentStrategyInventoryTab
          projectId={projectId}
          workspace={workspace}
          onChanged={onChanged}
        />
      )}
      {tab === "keywords" && (
        <ContentStrategyKeywordsTab
          projectId={projectId}
          workspace={workspace}
          onChanged={onChanged}
        />
      )}
      {tab === "knowledge" && (
        <ContentStrategyKnowledgeTab
          projectId={projectId}
          workspace={workspace}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

function WorkspaceTabs({
  tab,
  setTab,
}: {
  tab: WorkspaceTab;
  setTab: (tab: WorkspaceTab) => void;
}) {
  const tabs: { id: WorkspaceTab; label: string }[] = [
    { id: "inventory", label: "URLs" },
    { id: "keywords", label: "Keywords" },
    { id: "knowledge", label: "Agent knowledge" },
  ];
  return (
    <div role="tablist" className="tabs tabs-boxed w-fit">
      {tabs.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          className={`tab tab-sm ${tab === item.id ? "tab-active" : ""}`}
          onClick={() => setTab(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function WorkspaceSummary({ workspace }: { workspace: Workspace }) {
  const items = [
    {
      label: "Existing URLs",
      value: workspace.summary.existingUrls,
      detail: `${workspace.summary.blogUrls} blog · ${workspace.summary.pillarUrls} pillars`,
    },
    {
      label: "Keyword plan",
      value: workspace.summary.keywords,
      detail: `${workspace.summary.plannedKeywords} planned · ${workspace.summary.coveredKeywords} covered`,
    },
    {
      label: "Agent documents",
      value: workspace.summary.documents,
      detail: "plans, guidelines, rubrics",
    },
    {
      label: "Needs attention",
      value: workspace.summary.needsAttention,
      detail: `${workspace.summary.plannedUrls} URLs still planned`,
    },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-box border border-base-300 p-3"
        >
          <div className="text-xs text-base-content/60">{item.label}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {item.value}
          </div>
          <div className="text-xs text-base-content/50">{item.detail}</div>
        </div>
      ))}
    </div>
  );
}
