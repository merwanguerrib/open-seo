import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  deleteArticle,
  generateArticle,
  listArticles,
  retryArticle,
} from "@/serverFunctions/content";
import {
  ContentStatusBadge,
  isArticleInProgress,
} from "@/client/features/content/contentStatus";

const IN_PROGRESS_POLL_MS = 4_000;

export function ContentListPage({
  projectId,
  initialKeyword,
}: {
  projectId: string;
  initialKeyword?: string;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const articlesQuery = useQuery({
    queryKey: ["content-articles", projectId],
    queryFn: () => listArticles({ data: { projectId } }),
    refetchInterval: (query) =>
      query.state.data?.some((article) => isArticleInProgress(article.status))
        ? IN_PROGRESS_POLL_MS
        : false,
  });

  const generateMutation = useMutation({
    mutationFn: (keyword: string) =>
      generateArticle({ data: { projectId, keyword } }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: ["content-articles", projectId],
      });
      void navigate({
        to: "/p/$projectId/content/$articleId",
        params: { projectId, articleId: result.articleId },
      });
    },
    onError: (error) => {
      toast.error(getStandardErrorMessage(error, "Failed to start generation"));
    },
  });

  const retryMutation = useMutation({
    mutationFn: (articleId: string) =>
      retryArticle({ data: { projectId, articleId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["content-articles", projectId],
      });
    },
    onError: (error) => {
      toast.error(getStandardErrorMessage(error, "Failed to retry"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (articleId: string) =>
      deleteArticle({ data: { projectId, articleId } }),
    onSuccess: () => {
      toast.success("Article deleted");
      void queryClient.invalidateQueries({
        queryKey: ["content-articles", projectId],
      });
    },
    onError: (error) => {
      toast.error(getStandardErrorMessage(error, "Failed to delete"));
    },
  });

  const articles = articlesQuery.data ?? [];

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Articles</h1>
        <p className="text-sm text-base-content/70">
          SEO articles generated from live Google results, served by the
          headless content API
        </p>
      </div>

      <GenerateArticleForm
        initialKeyword={initialKeyword}
        isPending={generateMutation.isPending}
        onGenerate={(keyword) => generateMutation.mutate(keyword)}
      />

      <div className="card bg-base-100 border border-base-300">
        <div className="card-body p-0">
          {articlesQuery.isLoading ? (
            <div className="flex justify-center p-10">
              <span className="loading loading-spinner loading-md" />
            </div>
          ) : articles.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <FileText className="size-8 text-base-content/30" />
              <p className="text-sm text-base-content/60">
                No articles yet. Generate your first one from a keyword above,
                or from Keyword Research and Saved Keywords.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-zebra table-sm">
                <thead>
                  <tr>
                    <th>Article</th>
                    <th>Keyword</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {articles.map((article) => (
                    <tr key={article.id}>
                      <td className="max-w-xs">
                        <Link
                          to="/p/$projectId/content/$articleId"
                          params={{ projectId, articleId: article.id }}
                          className="link link-hover font-medium"
                        >
                          {article.title ?? article.slug}
                        </Link>
                        {article.status === "failed" && article.error && (
                          <p className="mt-0.5 truncate text-xs text-error">
                            {article.error}
                          </p>
                        )}
                      </td>
                      <td className="text-sm">{article.keyword}</td>
                      <td>
                        <ContentStatusBadge status={article.status} />
                      </td>
                      <td className="text-xs text-base-content/55">
                        {article.updatedAt}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          {article.status === "failed" && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              disabled={retryMutation.isPending}
                              onClick={() => retryMutation.mutate(article.id)}
                              title="Retry generation"
                            >
                              <RotateCcw className="size-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs text-error"
                            disabled={deleteMutation.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete "${article.title ?? article.keyword}"? This cannot be undone.`,
                                )
                              ) {
                                deleteMutation.mutate(article.id);
                              }
                            }}
                            title="Delete article"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function GenerateArticleForm({
  initialKeyword,
  isPending,
  onGenerate,
}: {
  initialKeyword?: string;
  isPending: boolean;
  onGenerate: (keyword: string) => void;
}) {
  const [keyword, setKeyword] = React.useState(initialKeyword ?? "");

  return (
    <form
      className="card bg-base-100 border border-base-300"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = keyword.trim();
        if (trimmed) onGenerate(trimmed);
      }}
    >
      <div className="card-body gap-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            className="input input-bordered flex-1"
            placeholder="Target keyword, e.g. best project management software"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isPending || !keyword.trim()}
          >
            {isPending && (
              <span className="loading loading-spinner loading-xs" />
            )}
            Generate article
          </button>
        </div>
        <p className="text-xs text-base-content/60">
          Reads the live Google results for the keyword, builds a brief from the
          pages that already rank, then writes a draft you can review and
          publish.
        </p>
      </div>
    </form>
  );
}
