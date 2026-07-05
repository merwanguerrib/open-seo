import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Copy, Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getArticle,
  setArticleStatus,
  updateArticle,
} from "@/serverFunctions/content";
import {
  ContentStatusBadge,
  isArticleInProgress,
} from "@/client/features/content/contentStatus";
import { ArticleSidePanel } from "@/client/features/content/ArticleSidePanel";
import { holdArticle } from "@/serverFunctions/contentPlan";

const IN_PROGRESS_POLL_MS = 4_000;

type ArticleView = Awaited<ReturnType<typeof getArticle>>;

export function ArticleEditorPage({
  projectId,
  articleId,
}: {
  projectId: string;
  articleId: string;
}) {
  const articleQuery = useQuery({
    queryKey: ["content-article", projectId, articleId],
    queryFn: () => getArticle({ data: { projectId, articleId } }),
    refetchInterval: (query) =>
      query.state.data && isArticleInProgress(query.state.data.status)
        ? IN_PROGRESS_POLL_MS
        : false,
  });

  const article = articleQuery.data;

  return (
    <>
      <Link
        to="/p/$projectId/content"
        params={{ projectId }}
        search={{}}
        className="inline-flex items-center gap-1 text-sm text-base-content/60 transition-colors hover:text-base-content"
      >
        <ChevronLeft className="size-4" />
        Articles
      </Link>

      {!article ? (
        <div className="flex justify-center p-10">
          <span className="loading loading-spinner loading-md" />
        </div>
      ) : isArticleInProgress(article.status) ? (
        <GeneratingState article={article} />
      ) : (
        // key resets the editor's local state when a regeneration lands
        <Editor
          key={article.updatedAt}
          projectId={projectId}
          article={article}
        />
      )}
    </>
  );
}

function GeneratingState({ article }: { article: ArticleView }) {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body items-center gap-3 p-10 text-center">
        <span className="loading loading-spinner loading-lg" />
        <div>
          <p className="font-medium">
            Writing an article for “{article.keyword}”
          </p>
          <p className="text-sm text-base-content/60">
            Reading the live SERP, building the brief, then drafting. This
            usually takes a few minutes — you can leave this page.
          </p>
        </div>
        <ContentStatusBadge status={article.status} />
      </div>
    </div>
  );
}

function Editor({
  projectId,
  article,
}: {
  projectId: string;
  article: ArticleView;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = React.useState(article.title ?? "");
  const [metaDescription, setMetaDescription] = React.useState(
    article.metaDescription ?? "",
  );
  const [slug, setSlug] = React.useState(article.slug);
  const [author, setAuthor] = React.useState(article.author ?? "");
  const [markdown, setMarkdown] = React.useState(article.markdown ?? "");
  const [tab, setTab] = React.useState<"edit" | "preview">("edit");

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["content-article", projectId, article.id],
    });
    void queryClient.invalidateQueries({
      queryKey: ["content-articles", projectId],
    });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      updateArticle({
        data: {
          projectId,
          articleId: article.id,
          title,
          metaDescription,
          slug,
          author: author.trim() ? author : null,
          markdown,
        },
      }),
    onSuccess: () => {
      toast.success("Article saved");
      invalidate();
    },
    onError: (error) => {
      toast.error(getStandardErrorMessage(error, "Failed to save"));
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: "draft" | "published") =>
      setArticleStatus({ data: { projectId, articleId: article.id, status } }),
    onSuccess: (updated) => {
      toast.success(
        updated.status === "published"
          ? "Article published — now served by the content API"
          : "Article unpublished",
      );
      invalidate();
    },
    onError: (error) => {
      toast.error(getStandardErrorMessage(error, "Failed to update status"));
    },
  });

  const holdMutation = useMutation({
    mutationFn: () =>
      holdArticle({ data: { projectId, articleId: article.id } }),
    onSuccess: () => {
      toast.success("Auto-publish cancelled — kept as draft");
      invalidate();
    },
    onError: (error) => {
      toast.error(getStandardErrorMessage(error, "Failed to hold"));
    },
  });

  const isFailed = article.status === "failed";

  return (
    <div className="space-y-4">
      {article.autoPublishAt && article.status === "draft" && (
        <div className="alert alert-info flex-wrap gap-2 text-sm">
          <span>
            Autopilot will publish this on{" "}
            <span className="font-medium">
              {article.autoPublishAt.slice(0, 16).replace("T", " ")}
            </span>{" "}
            unless you edit or hold it.
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={holdMutation.isPending}
            onClick={() => holdMutation.mutate()}
          >
            Keep as draft
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {article.title ?? article.keyword}
          </h1>
          <ContentStatusBadge status={article.status} />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void navigator.clipboard.writeText(markdown);
              toast.success("Markdown copied");
            }}
          >
            <Copy className="size-4" />
            Copy
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => downloadMarkdown(slug, markdown)}
          >
            <Download className="size-4" />
            .md
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending && (
              <span className="loading loading-spinner loading-xs" />
            )}
            Save
          </button>
          {!isFailed && (
            <button
              type="button"
              className={`btn btn-sm ${article.status === "published" ? "btn-outline" : "btn-primary"}`}
              disabled={statusMutation.isPending}
              onClick={() =>
                statusMutation.mutate(
                  article.status === "published" ? "draft" : "published",
                )
              }
            >
              {article.status === "published" ? "Unpublish" : "Publish"}
            </button>
          )}
        </div>
      </div>

      {isFailed && article.error && (
        <div className="alert alert-error text-sm">{article.error}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <div className="card bg-base-100 border border-base-300">
            <div className="card-body gap-3 p-4">
              <label className="form-control">
                <span className="label-text text-xs">Title</span>
                <input
                  className="input input-bordered input-sm"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="form-control">
                <span className="label-text text-xs">Meta description</span>
                <textarea
                  className="textarea textarea-bordered textarea-sm"
                  rows={2}
                  value={metaDescription}
                  onChange={(event) => setMetaDescription(event.target.value)}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="form-control">
                  <span className="label-text text-xs">Slug</span>
                  <input
                    className="input input-bordered input-sm font-mono"
                    value={slug}
                    onChange={(event) => setSlug(event.target.value)}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text text-xs">Author</span>
                  <input
                    className="input input-bordered input-sm"
                    placeholder="Byline for E-E-A-T (optional)"
                    value={author}
                    onChange={(event) => setAuthor(event.target.value)}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="card bg-base-100 border border-base-300">
            <div className="card-body gap-3 p-4">
              <div role="tablist" className="tabs tabs-border w-fit">
                <button
                  role="tab"
                  type="button"
                  className={`tab ${tab === "edit" ? "tab-active" : ""}`}
                  onClick={() => setTab("edit")}
                >
                  Markdown
                </button>
                <button
                  role="tab"
                  type="button"
                  className={`tab ${tab === "preview" ? "tab-active" : ""}`}
                  onClick={() => setTab("preview")}
                >
                  Preview
                </button>
              </div>
              {tab === "edit" ? (
                <textarea
                  className="textarea textarea-bordered w-full font-mono text-sm leading-relaxed"
                  rows={28}
                  value={markdown}
                  onChange={(event) => setMarkdown(event.target.value)}
                />
              ) : (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {markdown}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>

        <ArticleSidePanel projectId={projectId} article={article} />
      </div>
    </div>
  );
}

function downloadMarkdown(slug: string, markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slug}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}
