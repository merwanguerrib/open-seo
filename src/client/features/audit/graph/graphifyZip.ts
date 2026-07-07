import { strToU8, zipSync } from "fflate";

export function buildGraphifyZip(
  files: Array<{ path: string; content: string }>,
): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[`graphify-input/${file.path}`] = strToU8(file.content);
  }
  return zipSync(entries);
}

export function downloadZip(filename: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
