/**
 * Bearer keys for the public headless content API. Keys are random 32-byte
 * tokens with a recognizable prefix; only the SHA-256 hash is stored, so a
 * leaked database dump can't be replayed against the API.
 */

export const CONTENT_API_KEY_PREFIX = "osk_";

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function hashContentApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function generateContentApiKey(): Promise<{
  key: string;
  keyHash: string;
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = `${CONTENT_API_KEY_PREFIX}${base64Url(bytes)}`;
  return { key, keyHash: await hashContentApiKey(key) };
}
