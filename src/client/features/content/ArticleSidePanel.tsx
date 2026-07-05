import { ArticleJourneyPanel } from "@/client/features/content/ArticleJourneyPanel";
import type { getArticle } from "@/serverFunctions/content";

type ArticleView = Awaited<ReturnType<typeof getArticle>>;

export function ArticleSidePanel({
  projectId,
  article,
}: {
  projectId: string;
  article: ArticleView;
}) {
  const brief = article.brief as {
    intent?: string;
    angle?: string;
  } | null;

  const showJourney =
    article.source === "autopilot" || article.status === "published";

  return (
    <div className="space-y-4">
      {showJourney && (
        <ArticleJourneyPanel projectId={projectId} articleId={article.id} />
      )}
      <div className="card bg-base-100 border border-base-300">
        <div className="card-body gap-2 p-4 text-sm">
          <h2 className="text-xs font-medium uppercase text-base-content/50">
            Target
          </h2>
          <p>
            <span className="font-medium">{article.keyword}</span>
            <span className="text-base-content/50">
              {" "}
              · {article.languageCode}
            </span>
          </p>
          {brief?.intent && (
            <p className="text-base-content/70">
              Intent:{" "}
              <span className="badge badge-ghost badge-sm">{brief.intent}</span>
            </p>
          )}
          {brief?.angle && (
            <p className="text-xs text-base-content/60">{brief.angle}</p>
          )}
        </div>
      </div>

      {article.faq.length > 0 && (
        <div className="card bg-base-100 border border-base-300">
          <div className="card-body gap-2 p-4 text-sm">
            <h2 className="text-xs font-medium uppercase text-base-content/50">
              FAQ (served as FAQPage JSON-LD)
            </h2>
            <ul className="space-y-1">
              {article.faq.map((entry) => (
                <li key={entry.question} className="text-xs">
                  <span className="font-medium">{entry.question}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {article.sourceUrls.length > 0 && (
        <div className="card bg-base-100 border border-base-300">
          <div className="card-body gap-2 p-4">
            <h2 className="text-xs font-medium uppercase text-base-content/50">
              Grounding sources
            </h2>
            <ul className="space-y-1">
              {article.sourceUrls.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="link link-hover break-all text-xs text-base-content/70"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
