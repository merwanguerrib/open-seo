import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { AutopilotTopicQueue } from "@/client/features/content/AutopilotTopicQueue";
import {
  getContentPlan,
  listContentCalendar,
  runContentDiscovery,
  updateContentPlan,
} from "@/serverFunctions/contentPlan";

type Plan = Awaited<ReturnType<typeof getContentPlan>>;

export function AutopilotPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const planQuery = useQuery({
    queryKey: ["content-plan", projectId],
    queryFn: () => getContentPlan({ data: { projectId } }),
  });
  const calendarQuery = useQuery({
    queryKey: ["content-calendar", projectId],
    queryFn: () => listContentCalendar({ data: { projectId } }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["content-plan", projectId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["content-calendar", projectId],
    });
  };

  const discoverMutation = useMutation({
    mutationFn: () => runContentDiscovery({ data: { projectId } }),
    onSuccess: (result) => {
      toast.success(
        result.discovered > 0
          ? `Discovered ${result.discovered} new topic${result.discovered !== 1 ? "s" : ""}`
          : "No new topics found this run",
      );
      invalidate();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Discovery failed")),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Autopilot</h1>
          <p className="text-sm text-base-content/70">
            Discover winnable topics, publish on a cadence, and improve
            underperformers automatically
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={discoverMutation.isPending}
          onClick={() => discoverMutation.mutate()}
        >
          {discoverMutation.isPending ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            <Sparkles className="size-4" />
          )}
          Discover topics now
        </button>
      </div>

      {planQuery.data && (
        <PlanSettings
          projectId={projectId}
          plan={planQuery.data}
          onSaved={invalidate}
        />
      )}

      <AutopilotTopicQueue
        projectId={projectId}
        calendar={calendarQuery.data}
        isLoading={calendarQuery.isLoading}
        onChanged={invalidate}
      />
    </div>
  );
}

function PlanSettings({
  projectId,
  plan,
  onSaved,
}: {
  projectId: string;
  plan: Plan;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = React.useState(plan.enabled);
  const [cadence, setCadence] = React.useState(String(plan.cadencePerWeek));
  const [reviewHours, setReviewHours] = React.useState(
    String(plan.reviewWindowHours),
  );
  const [autoPublish, setAutoPublish] = React.useState(plan.autoPublish);
  const [minVolume, setMinVolume] = React.useState(
    String(plan.minSearchVolume),
  );
  const [maxDifficulty, setMaxDifficulty] = React.useState(
    String(plan.maxDifficulty),
  );
  const [blogUrlPattern, setBlogUrlPattern] = React.useState(
    plan.blogUrlPattern ?? "",
  );

  const saveMutation = useMutation({
    mutationFn: (nextEnabled?: boolean) =>
      updateContentPlan({
        data: {
          projectId,
          enabled: nextEnabled ?? enabled,
          cadencePerWeek: clampInt(cadence, 1, 21, 3),
          reviewWindowHours: clampInt(reviewHours, 0, 720, 72),
          autoPublish,
          minSearchVolume: clampInt(minVolume, 0, 1_000_000, 50),
          maxDifficulty: clampInt(maxDifficulty, 0, 100, 40),
          blogUrlPattern: blogUrlPattern.trim() || null,
        },
      }),
    onSuccess: (updated) => {
      setEnabled(updated.enabled);
      toast.success("Autopilot settings saved");
      onSaved();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to save settings")),
  });

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">
              {enabled ? "Autopilot is on" : "Autopilot is off"}
            </h2>
            <p className="text-sm text-base-content/60">
              {enabled
                ? "Articles are generated and published on your cadence."
                : "Enable to let the calendar fill and publish itself."}
            </p>
          </div>
          <input
            type="checkbox"
            className="toggle toggle-primary"
            checked={enabled}
            disabled={saveMutation.isPending}
            onChange={(event) => {
              setEnabled(event.target.checked);
              saveMutation.mutate(event.target.checked);
            }}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="Articles per week"
            value={cadence}
            onChange={setCadence}
          />
          <NumberField
            label="Review window (hours)"
            value={reviewHours}
            onChange={setReviewHours}
            help="0 = publish immediately"
          />
          <NumberField
            label="Min search volume"
            value={minVolume}
            onChange={setMinVolume}
          />
          <NumberField
            label="Max difficulty (0-100)"
            value={maxDifficulty}
            onChange={setMaxDifficulty}
          />
          <label className="form-control">
            <span className="label-text text-xs">Blog URL pattern</span>
            <input
              className="input input-bordered input-sm font-mono"
              placeholder="https://site.com/blog/{slug}"
              value={blogUrlPattern}
              onChange={(event) => setBlogUrlPattern(event.target.value)}
            />
          </label>
          <label className="form-control justify-end">
            <span className="label-text flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={autoPublish}
                onChange={(event) => setAutoPublish(event.target.checked)}
              />
              Auto-publish after review window
            </span>
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            className="btn btn-sm"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate(undefined)}
          >
            Save settings
          </button>
        </div>

        {!plan.blogUrlPattern && (
          <p className="text-xs text-warning">
            Set a blog URL pattern so published articles can be tracked in
            Search Console and improved automatically.
          </p>
        )}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  help,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
}) {
  return (
    <label className="form-control">
      <span className="label-text text-xs">{label}</span>
      <input
        className="input input-bordered input-sm"
        value={value}
        inputMode="numeric"
        onChange={(event) => onChange(event.target.value)}
      />
      {help && (
        <span className="mt-1 text-xs text-base-content/50">{help}</span>
      )}
    </label>
  );
}

function clampInt(
  value: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
