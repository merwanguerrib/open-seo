/** Data access for content_api_keys (headless content API bearer keys). */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { contentApiKeys } from "@/db/schema";

async function createApiKey(data: {
  id: string;
  projectId: string;
  keyHash: string;
  label: string;
}) {
  await db.insert(contentApiKeys).values(data);
}

async function listApiKeysForProject(projectId: string) {
  return db
    .select({
      id: contentApiKeys.id,
      label: contentApiKeys.label,
      createdAt: contentApiKeys.createdAt,
      lastUsedAt: contentApiKeys.lastUsedAt,
      revokedAt: contentApiKeys.revokedAt,
    })
    .from(contentApiKeys)
    .where(eq(contentApiKeys.projectId, projectId))
    .orderBy(desc(contentApiKeys.createdAt));
}

async function revokeApiKeyForProject(keyId: string, projectId: string) {
  await db
    .update(contentApiKeys)
    .set({ revokedAt: sql`(current_timestamp)` })
    .where(
      and(
        eq(contentApiKeys.id, keyId),
        eq(contentApiKeys.projectId, projectId),
      ),
    );
}

/** Resolves an active (non-revoked) key by hash and stamps last_used_at. */
async function resolveActiveApiKeyByHash(keyHash: string) {
  const rows = await db
    .select()
    .from(contentApiKeys)
    .where(
      and(
        eq(contentApiKeys.keyHash, keyHash),
        isNull(contentApiKeys.revokedAt),
      ),
    )
    .limit(1);
  const key = rows[0];
  if (!key) return null;

  await db
    .update(contentApiKeys)
    .set({ lastUsedAt: sql`(current_timestamp)` })
    .where(eq(contentApiKeys.id, key.id));

  return key;
}

export const ContentApiKeyRepository = {
  createApiKey,
  listApiKeysForProject,
  revokeApiKeyForProject,
  resolveActiveApiKeyByHash,
};
