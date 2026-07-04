import { createFileRoute } from "@tanstack/react-router";
import {
  getPublishedArticleResponse,
  resolveProjectFromBearer,
} from "@/server/features/content/services/headlessApi";

/**
 * Public headless content API — fetch one published article by slug, with
 * markdown, rendered HTML, FAQ, and ready-to-embed JSON-LD.
 */
export const Route = createFileRoute("/api/content/v1/articles/$slug")({
  server: {
    handlers: {
      GET: async ({
        request,
        params,
      }: {
        request: Request;
        params: { slug: string };
      }) => {
        const projectId = await resolveProjectFromBearer(
          request.headers.get("authorization"),
        );
        if (!projectId) {
          return Response.json({ error: "Invalid API key" }, { status: 401 });
        }

        const article = await getPublishedArticleResponse(
          projectId,
          params.slug,
        );
        if (!article) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }
        return Response.json(article);
      },
    },
  },
});
