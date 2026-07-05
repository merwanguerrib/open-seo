import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  dismissContentTopic,
  generateContentTopicNow,
  type listContentCalendar,
} from "@/serverFunctions/contentPlan";

type Calendar = Awaited<ReturnType<typeof listContentCalendar>>;
type CalendarTopic = Calendar["topics"][number];

export function AutopilotTopicQueue({
  projectId,
  calendar,
  isLoading,
  onChanged,
}: {
  projectId: string;
  calendar: Calendar | undefined;
  isLoading: boolean;
  onChanged: () => void;
}) {
  const dismissMutation = useMutation({
    mutationFn: (topicId: string) =>
      dismissContentTopic({ data: { projectId, topicId } }),
    onSuccess: onChanged,
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to dismiss")),
  });
  const generateMutation = useMutation({
    mutationFn: (topicId: string) =>
      generateContentTopicNow({ data: { projectId, topicId } }),
    onSuccess: () => {
      toast.success("Generating article");
      onChanged();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to generate")),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center p-10">
        <span className="loading loading-spinner loading-md" />
      </div>
    );
  }

  const topics = calendar?.topics ?? [];
  const scheduled = topics.filter((t) => t.status === "scheduled");
  const suggested = topics.filter((t) => t.status === "suggested");
  const inProgress = topics.filter(
    (t) => t.status === "generating" || t.status === "generated",
  );

  if (topics.length === 0) {
    return (
      <div className="card bg-base-100 border border-base-300">
        <div className="card-body items-center gap-2 p-10 text-center">
          <Sparkles className="size-8 text-base-content/30" />
          <p className="text-sm text-base-content/60">
            No topics yet. Click “Discover topics now” to find winnable keywords
            from Search Console and keyword expansion.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TopicSection
        title="Scheduled"
        subtitle="On the calendar, generating on their date"
        projectId={projectId}
        topics={scheduled}
        showDate
        onDismiss={(id) => dismissMutation.mutate(id)}
        onGenerate={(id) => generateMutation.mutate(id)}
        generating={generateMutation.isPending}
      />
      <TopicSection
        title="Backlog"
        subtitle="Discovered, waiting for a calendar slot"
        projectId={projectId}
        topics={suggested}
        onDismiss={(id) => dismissMutation.mutate(id)}
        onGenerate={(id) => generateMutation.mutate(id)}
        generating={generateMutation.isPending}
      />
      <TopicSection
        title="Generated"
        subtitle="Articles created from these topics"
        projectId={projectId}
        topics={inProgress}
      />
    </div>
  );
}

function TopicSection({
  title,
  subtitle,
  projectId,
  topics,
  showDate,
  onDismiss,
  onGenerate,
  generating,
}: {
  title: string;
  subtitle: string;
  projectId: string;
  topics: CalendarTopic[];
  showDate?: boolean;
  onDismiss?: (topicId: string) => void;
  onGenerate?: (topicId: string) => void;
  generating?: boolean;
}) {
  if (topics.length === 0) return null;
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-2 p-4">
        <div>
          <h2 className="text-sm font-medium">
            {title}{" "}
            <span className="text-base-content/50">({topics.length})</span>
          </h2>
          <p className="text-xs text-base-content/60">{subtitle}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="table table-zebra table-sm">
            <thead>
              <tr>
                {showDate && <th>Date</th>}
                <th>Keyword</th>
                <th>Cluster</th>
                <th>Role</th>
                <th className="text-right">Volume</th>
                <th className="text-right">Diff.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {topics.map((topic) => (
                <tr key={topic.id}>
                  {showDate && (
                    <td className="whitespace-nowrap text-xs">
                      {topic.scheduledFor ?? "—"}
                    </td>
                  )}
                  <td className="font-medium">{topic.keyword}</td>
                  <td className="text-xs text-base-content/70">
                    {topic.clusterName ?? "—"}
                  </td>
                  <td>
                    <span
                      className={`badge badge-sm ${topic.role === "pillar" ? "badge-primary" : "badge-ghost"}`}
                    >
                      {topic.role}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">
                    {topic.searchVolume ?? "—"}
                  </td>
                  <td className="text-right tabular-nums">
                    {topic.difficulty ?? "—"}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {topic.articleId ? (
                        <Link
                          to="/p/$projectId/content/$articleId"
                          params={{ projectId, articleId: topic.articleId }}
                          className="btn btn-ghost btn-xs"
                        >
                          View
                        </Link>
                      ) : (
                        <>
                          {onGenerate && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              disabled={generating}
                              onClick={() => onGenerate(topic.id)}
                              title="Generate now"
                            >
                              <Zap className="size-3.5" />
                            </button>
                          )}
                          {onDismiss && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs text-error"
                              onClick={() => onDismiss(topic.id)}
                              title="Dismiss"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
