import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditPages, audits } from "@/db/schema";

async function getLatestCompletedContentSnapshot(projectId: string) {
  const audit = await db.query.audits.findFirst({
    where: and(eq(audits.projectId, projectId), eq(audits.status, "completed")),
    orderBy: desc(audits.startedAt),
  });
  if (!audit) return null;

  const pages = await db
    .select({
      url: auditPages.url,
      statusCode: auditPages.statusCode,
      title: auditPages.title,
      metaDescription: auditPages.metaDescription,
      wordCount: auditPages.wordCount,
      h1Count: auditPages.h1Count,
      isIndexable: auditPages.isIndexable,
      hasStructuredData: auditPages.hasStructuredData,
      crawlDepth: auditPages.crawlDepth,
      internalLinkCount: auditPages.internalLinkCount,
    })
    .from(auditPages)
    .where(eq(auditPages.auditId, audit.id));

  return { audit, pages };
}

export const ContentAuditRepository = {
  getLatestCompletedContentSnapshot,
};
