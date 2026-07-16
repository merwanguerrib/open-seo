import { z } from "zod";
import { buildSlugMap } from "@/server/lib/audit/graphify-export";

const graphifyNodeSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    community: z.union([z.number(), z.string()]).optional(),
    source: z.string().optional(),
    sources: z.array(z.string()).optional(),
  })
  .loose();

export const graphifyGraphJsonSchema = z
  .object({
    nodes: z.array(graphifyNodeSchema),
    community_labels: z.record(z.string(), z.string()).optional(),
  })
  .loose();

export type GraphifyGraphJson = z.infer<typeof graphifyGraphJsonSchema>;

/** "graphify-input/pages/about.md" | "./pages/about.md" | "pages/about.md" → "about" */
function slugFromFileRef(ref: string): string | null {
  const match = /(?:^|\/)pages\/([^/]+)\.md$/.exec(ref);
  return match ? match[1] : null;
}

export function mapGraphifyClustersToPages(input: {
  graphJson: GraphifyGraphJson;
  pages: Array<{ id: string; url: string }>;
}): Array<{ pageId: string; clusterLabel: string }> {
  const slugByUrl = buildSlugMap(input.pages.map((p) => p.url));
  const pageIdBySlug = new Map(
    input.pages.map((p) => [slugByUrl.get(p.url) as string, p.id]),
  );

  // pageId → community → votes
  const votes = new Map<string, Map<string, number>>();
  for (const node of input.graphJson.nodes) {
    if (node.community == null) continue;
    const community = String(node.community);
    const refs = [
      ...(node.source ? [node.source] : []),
      ...(node.sources ?? []),
    ];
    for (const ref of refs) {
      const slug = slugFromFileRef(ref);
      const pageId = slug ? pageIdBySlug.get(slug) : undefined;
      if (!pageId) continue;
      const pageVotes = votes.get(pageId) ?? new Map<string, number>();
      pageVotes.set(community, (pageVotes.get(community) ?? 0) + 1);
      votes.set(pageId, pageVotes);
    }
  }

  const labels = input.graphJson.community_labels ?? {};
  return [...votes.entries()].map(([pageId, pageVotes]) => {
    const [community] = [...pageVotes.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    return {
      pageId,
      clusterLabel: labels[community] ?? `Cluster ${community}`,
    };
  });
}
