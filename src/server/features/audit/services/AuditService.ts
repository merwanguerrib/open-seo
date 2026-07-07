import { env } from "cloudflare:workers";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import {
  MAX_USER_AUDIT_USAGE,
  clampAuditMaxPages,
  getEstimatedAuditCapacity,
} from "@/server/features/audit/services/audit-capacity";
import { AppError } from "@/server/lib/errors";
import { AuditProgressKV } from "@/server/lib/audit/progress-kv";
import {
  parseAuditConfig,
  type AuditConfig,
  type LighthouseStrategy,
} from "@/server/lib/audit/types";
import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import { buildAuditGraphPayload } from "@/server/lib/audit/graph-edges";
import { buildGraphifyExportFiles } from "@/server/lib/audit/graphify-export";
import {
  graphifyGraphJsonSchema,
  mapGraphifyClustersToPages,
} from "@/server/lib/audit/graphify-import";
import { getTextFromR2 } from "@/server/lib/r2";

async function startAudit(input: {
  actorUserId: string;
  billingCustomer: BillingCustomerContext;
  projectId: string;
  startUrl: string;
  maxPages?: number;
  lighthouseStrategy?: LighthouseStrategy;
  captureContent?: boolean;
}) {
  const maxPages = clampAuditMaxPages(input.maxPages);
  const lighthouseStrategy = input.lighthouseStrategy ?? "auto";
  const captureContent = input.captureContent ?? false;
  const reservation = getEstimatedAuditCapacity({
    maxPages,
    lighthouseStrategy,
  });

  const currentUsage = await AuditRepository.getAuditCapacityUsageForUser(
    input.actorUserId,
  );

  if (currentUsage + reservation.total > MAX_USER_AUDIT_USAGE) {
    throw new AppError("AUDIT_CAPACITY_REACHED");
  }

  const auditId = crypto.randomUUID();
  const config: AuditConfig = { maxPages, lighthouseStrategy, captureContent };
  const startUrl = await normalizeAndValidateStartUrl(input.startUrl);

  await AuditRepository.createAudit({
    id: auditId,
    projectId: input.projectId,
    startedByUserId: input.actorUserId,
    startUrl,
    workflowInstanceId: auditId,
    config,
    pagesTotal: reservation.pagesTotal,
    lighthouseTotal: reservation.lighthouseTotal,
  });

  try {
    await env.SITE_AUDIT_WORKFLOW.create({
      id: auditId,
      params: {
        auditId,
        billingCustomer: {
          userId: input.billingCustomer.userId,
          userEmail: input.billingCustomer.userEmail,
          organizationId: input.billingCustomer.organizationId,
          projectId: input.billingCustomer.projectId,
        },
        projectId: input.projectId,
        startUrl,
        config,
      },
    });
  } catch (error) {
    try {
      const instance = await env.SITE_AUDIT_WORKFLOW.get(auditId);
      await instance.terminate();
    } catch {
      // The workflow may never have been created, or may already be gone.
    }

    await AuditRepository.deleteAuditForProject(auditId, input.projectId);
    throw error;
  }

  return { auditId };
}

async function getStatus(auditId: string, projectId: string) {
  const audit = await AuditRepository.getAuditForProject(auditId, projectId);
  if (!audit) throw new AppError("NOT_FOUND");

  return {
    id: audit.id,
    startUrl: audit.startUrl,
    status: audit.status,
    pagesCrawled: audit.pagesCrawled,
    pagesTotal: audit.pagesTotal,
    lighthouseTotal: audit.lighthouseTotal,
    lighthouseCompleted: audit.lighthouseCompleted,
    lighthouseFailed: audit.lighthouseFailed,
    currentPhase: audit.currentPhase,
    startedAt: audit.startedAt,
    completedAt: audit.completedAt,
  };
}

async function getResults(auditId: string, projectId: string) {
  const { audit, pages, lighthouse } =
    await AuditRepository.getAuditResultsForProject(auditId, projectId);

  if (!audit) throw new AppError("NOT_FOUND");

  const parsedConfig = parseAuditConfig(audit.config);
  if (!parsedConfig) {
    throw new AppError("INTERNAL_ERROR", "Invalid audit configuration");
  }

  return {
    audit: {
      id: audit.id,
      startUrl: audit.startUrl,
      status: audit.status,
      pagesCrawled: audit.pagesCrawled,
      pagesTotal: audit.pagesTotal,
      startedAt: audit.startedAt,
      completedAt: audit.completedAt,
      config: parsedConfig,
    },
    pages,
    lighthouse,
  };
}

async function getHistory(projectId: string) {
  const auditList = await AuditRepository.getAuditsByProject(projectId);

  return auditList.map((audit) => {
    const parsedConfig = parseAuditConfig(audit.config);
    const ranLighthouse = parsedConfig?.lighthouseStrategy !== "none";

    return {
      id: audit.id,
      startUrl: audit.startUrl,
      status: audit.status,
      pagesCrawled: audit.pagesCrawled,
      pagesTotal: audit.pagesTotal,
      ranLighthouse,
      startedAt: audit.startedAt,
      completedAt: audit.completedAt,
    };
  });
}

async function getCrawlProgress(auditId: string, projectId: string) {
  const audit = await AuditRepository.getAuditForProject(auditId, projectId);
  if (!audit) {
    throw new AppError("NOT_FOUND");
  }

  return AuditProgressKV.getCrawledUrls(auditId);
}

async function getGraph(auditId: string, projectId: string) {
  const data = await AuditRepository.getAuditGraphData(auditId, projectId);
  if (!data) return null;
  return buildAuditGraphPayload({
    auditId,
    startUrl: data.audit.startUrl,
    contentCaptured:
      parseAuditConfig(data.audit.config)?.captureContent ?? false,
    pages: data.pages.map((p) => ({
      id: p.id, url: p.url, title: p.title, statusCode: p.statusCode,
      wordCount: p.wordCount, internalLinkCount: p.internalLinkCount,
      isIndexable: p.isIndexable,
      h1Count: p.h1Count, externalLinkCount: p.externalLinkCount,
      canonicalUrl: p.canonicalUrl,
    })),
    edges: data.edges,
    clusters: data.clusters,
  });
}

async function importGraphifyClusters(
  auditId: string,
  projectId: string,
  graphJsonRaw: unknown,
) {
  const audit = await AuditRepository.getAuditForProject(auditId, projectId);
  if (!audit) throw new AppError("NOT_FOUND");

  const parsed = graphifyGraphJsonSchema.safeParse(graphJsonRaw);
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This file does not look like a Graphify graph.json export.",
    );
  }

  const data = await AuditRepository.getAuditGraphData(auditId, projectId);
  if (!data) throw new AppError("NOT_FOUND");

  const rows = mapGraphifyClustersToPages({
    graphJson: parsed.data,
    pages: data.pages.map((p) => ({ id: p.id, url: p.url })),
  });
  if (rows.length === 0) {
    // Do not wipe existing clusters on a non-matching file (spec: no
    // overwrite when the import is invalid for this audit).
    throw new AppError(
      "VALIDATION_ERROR",
      "No Graphify nodes matched this audit's pages. Was the export generated from this audit?",
    );
  }

  await AuditRepository.replaceGraphifyClusters(auditId, rows);
  return { imported: rows.length };
}

async function exportForGraphify(auditId: string, projectId: string) {
  const data = await AuditRepository.getGraphifyExportData(auditId, projectId);
  if (!data) throw new AppError("NOT_FOUND");

  const withContent = data.pages.filter((p) => p.contentR2Key != null);
  if (withContent.length === 0) {
    throw new AppError(
      "CONFLICT",
      "This audit has no captured page content. Re-run it with content capture enabled.",
    );
  }

  const texts = await Promise.all(
    data.pages.map(async (page) => {
      if (!page.contentR2Key) return null;
      try {
        return await getTextFromR2(page.contentR2Key);
      } catch {
        return null; // a missing/unreadable object just drops that page
      }
    }),
  );

  const files = buildGraphifyExportFiles({
    auditId,
    startUrl: data.audit.startUrl,
    generatedAt: new Date().toISOString(),
    pages: data.pages.map((page, index) => ({
      id: page.id,
      url: page.url,
      title: page.title,
      statusCode: page.statusCode,
      text: texts[index],
    })),
    edges: data.edges,
  });

  return { files };
}

async function remove(auditId: string, projectId: string) {
  const audit = await AuditRepository.getAuditForProject(auditId, projectId);
  if (!audit) {
    throw new AppError("NOT_FOUND");
  }

  if (audit.status === "running") {
    if (!audit.workflowInstanceId) {
      throw new AppError(
        "CONFLICT",
        "Cannot delete a running audit without workflow context.",
      );
    }

    try {
      const instance = await env.SITE_AUDIT_WORKFLOW.get(
        audit.workflowInstanceId,
      );
      await instance.terminate();
    } catch (error) {
      console.error(`Failed to terminate audit workflow ${audit.id}:`, error);
      throw new AppError("CONFLICT", "Unable to stop the running audit.");
    }
  }

  await AuditRepository.deleteAuditForProject(auditId, projectId);
}

export const AuditService = {
  startAudit,
  getStatus,
  getCrawlProgress,
  getResults,
  getHistory,
  remove,
  getGraph,
  exportForGraphify,
  importGraphifyClusters,
} as const;
