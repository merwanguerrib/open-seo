import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  createContentApiKey,
  listContentApiKeys,
  revokeContentApiKey,
} from "@/serverFunctions/content";

/**
 * Manage bearer keys for the public headless content API. The plaintext key
 * is only available in the create response, so it's surfaced once here and
 * never again.
 */
export function ContentApiKeysCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = React.useState("");
  const [freshKey, setFreshKey] = React.useState<string | null>(null);

  const keysQuery = useQuery({
    queryKey: ["content-api-keys", projectId],
    queryFn: () => listContentApiKeys({ data: { projectId } }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createContentApiKey({ data: { projectId, label: label || "Default" } }),
    onSuccess: (result) => {
      setFreshKey(result.key);
      setLabel("");
      void queryClient.invalidateQueries({
        queryKey: ["content-api-keys", projectId],
      });
    },
    onError: (error) => {
      toast.error(getStandardErrorMessage(error, "Failed to create key"));
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) =>
      revokeContentApiKey({ data: { projectId, keyId } }),
    onSuccess: () => {
      toast.success("Key revoked");
      void queryClient.invalidateQueries({
        queryKey: ["content-api-keys", projectId],
      });
    },
    onError: (error) => {
      toast.error(getStandardErrorMessage(error, "Failed to revoke key"));
    },
  });

  const keys = keysQuery.data ?? [];
  const activeKeys = keys.filter((key) => !key.revokedAt);

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-4 p-4">
        <div>
          <h3 className="font-medium">Content API keys</h3>
          <p className="text-sm text-base-content/60">
            Pull published articles into your site — Next.js, Astro, or any
            framework — via the headless API.
          </p>
        </div>

        {freshKey && (
          <div className="alert alert-success flex-col items-start gap-2 text-sm">
            <p className="font-medium">
              Key created. Copy it now — it won't be shown again.
            </p>
            <div className="flex w-full items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded bg-base-100 px-2 py-1 font-mono text-xs">
                {freshKey}
              </code>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => {
                  void navigator.clipboard.writeText(freshKey);
                  toast.success("Key copied");
                }}
              >
                <Copy className="size-3.5" />
              </button>
            </div>
          </div>
        )}

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
        >
          <input
            className="input input-bordered input-sm flex-1"
            placeholder="Key label, e.g. production blog"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <button
            type="submit"
            className="btn btn-sm"
            disabled={createMutation.isPending}
          >
            Create key
          </button>
        </form>

        {activeKeys.length > 0 && (
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Label</th>
                <th>Created</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {activeKeys.map((key) => (
                <tr key={key.id}>
                  <td>{key.label}</td>
                  <td className="text-xs text-base-content/55">
                    {key.createdAt}
                  </td>
                  <td className="text-xs text-base-content/55">
                    {key.lastUsedAt ?? "Never"}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-error"
                      disabled={revokeMutation.isPending}
                      onClick={() => revokeMutation.mutate(key.id)}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="rounded-lg bg-base-200 p-3">
          <p className="mb-1 text-xs font-medium text-base-content/60">
            Fetch your published articles:
          </p>
          <code className="block overflow-x-auto whitespace-pre font-mono text-xs">
            {`curl ${typeof window !== "undefined" ? window.location.origin : ""}/api/content/v1/articles \\
  -H "Authorization: Bearer osk_..."`}
          </code>
        </div>
      </div>
    </div>
  );
}
