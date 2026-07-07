import { describe, expect, it } from "vitest";
import {
  CONTENT_API_KEY_PREFIX,
  generateContentApiKey,
  hashContentApiKey,
} from "./apiKeys";

describe("content API keys", () => {
  it("generates prefixed keys whose stored hash matches re-hashing", async () => {
    const { key, keyHash } = await generateContentApiKey();
    expect(key.startsWith(CONTENT_API_KEY_PREFIX)).toBe(true);
    expect(key.length).toBeGreaterThan(30);
    expect(await hashContentApiKey(key)).toBe(keyHash);
  });

  it("hashes deterministically and hex-encoded", async () => {
    const hash = await hashContentApiKey("osk_test");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashContentApiKey("osk_test")).toBe(hash);
    expect(await hashContentApiKey("osk_other")).not.toBe(hash);
  });

  it("generates unique keys", async () => {
    const first = await generateContentApiKey();
    const second = await generateContentApiKey();
    expect(first.key).not.toBe(second.key);
  });
});
