import { createFileRoute } from "@tanstack/react-router";
import {
  clampListLimit,
  listPublishedArticlesResponse,
  resolveProjectFromBearer,
} from "@/server/features/content/services/headlessApi";

/**
 * Public headless content API — list published articles.
 * Auth: `Authorization: Bearer <content API key>`; the key identifies the
 * project, so no project id appears in the URL.
 */
export const Route = createFileRoute("/api/content/v1/articles")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const projectId = await resolveProjectFromBearer(
          request.headers.get("authorization"),
        );
        if (!projectId) {
          return Response.json({ error: "Invalid API key" }, { status: 401 });
        }

        const limit = clampListLimit(
          new URL(request.url).searchParams.get("limit"),
        );
        const body = await listPublishedArticlesResponse(projectId, limit);
        return Response.json(body);
      },
    },
  },
});
