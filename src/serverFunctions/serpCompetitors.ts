import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { normalizeDomainInput } from "@/server/lib/domainUtils";
import { requireProjectContext } from "@/serverFunctions/middleware";

const getSerpCompetitorsSchema = z.object({
  projectId: z.string().min(1),
  keywords: z.array(z.string().min(1).max(200)).min(1).max(20),
  includeSubdomains: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

type SerpCompetitorRow = {
  domain: string;
  avgPosition: number | null;
  medianPosition: number | null;
  rating: number | null;
  etv: number | null;
  keywordsCount: number | null;
  visibility: number | null;
  /** True when this competitor is the project's own domain. */
  isSelf: boolean;
};

/** Find the domains that dominate the SERPs for a set of keywords, ranked by
 *  visibility. Flags the project's own domain so the UI can highlight it. */
export const getSerpCompetitors = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => getSerpCompetitorsSchema.parse(data))
  .handler(async ({ data, context }) => {
    const client = createDataforseoClient(context);
    const items = await client.labs.serpCompetitors({
      keywords: data.keywords,
      locationCode: context.project.locationCode,
      languageCode: context.project.languageCode,
      includeSubdomains: data.includeSubdomains ?? false,
      limit: data.limit ?? 50,
      creditFeature: "domain_overview",
    });

    // The project domain is user-entered and may be blank or malformed; a bad
    // value just means we can't flag "you", not a hard error.
    let selfDomain: string | null = null;
    if (context.project.domain) {
      try {
        selfDomain = normalizeDomainInput(context.project.domain, false);
      } catch {
        selfDomain = null;
      }
    }

    const rows: SerpCompetitorRow[] = items.map((item) => {
      const domain = item.domain ?? "";
      return {
        domain,
        avgPosition: item.avg_position ?? null,
        medianPosition: item.median_position ?? null,
        rating: item.rating ?? null,
        etv: item.etv ?? null,
        keywordsCount: item.keywords_count ?? null,
        visibility: item.visibility ?? null,
        isSelf: selfDomain != null && domain === selfDomain,
      };
    });

    return {
      keywords: data.keywords,
      selfDomain,
      competitors: rows,
    };
  });
