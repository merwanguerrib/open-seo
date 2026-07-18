import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import type {
  DocumentFormat,
  DocumentKind,
  Workspace,
} from "@/client/features/content/contentStrategyTypes";

const MAX_FILE_SIZE = 1_000_000;

export function HealthBadge({
  health,
}: {
  health: Workspace["assets"][number]["health"];
}) {
  if (health.status === "healthy") {
    return (
      <span className="badge badge-success badge-sm gap-1">
        <CheckCircle2 className="size-3" />
        Healthy
      </span>
    );
  }
  if (health.status === "critical" || health.status === "needs_attention") {
    return (
      <div
        className="tooltip tooltip-left"
        data-tip={health.issues.join(" · ")}
      >
        <span
          className={`badge badge-sm gap-1 ${health.status === "critical" ? "badge-error" : "badge-warning"}`}
        >
          <AlertTriangle className="size-3" />
          {health.issues.length} issue{health.issues.length === 1 ? "" : "s"}
        </span>
      </div>
    );
  }
  return (
    <span className="badge badge-outline badge-sm gap-1">
      <CircleDashed className="size-3" />
      {health.status === "planned" ? "Planned" : "Not analyzed"}
    </span>
  );
}

export function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-box bg-base-200 p-6 text-center text-base-content/50">
      {icon}
      <p className="max-w-md text-sm">{text}</p>
    </div>
  );
}

export async function readTextFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("File is larger than 1 MB.");
  }
  return file.text();
}

export function formatFromFilename(filename: string): DocumentFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  return "text";
}

export function kindFromFilename(filename: string): DocumentKind {
  const lower = filename.toLowerCase();
  if (lower.includes("master") || lower.includes("cluster-plan")) {
    return "master_plan";
  }
  if (
    lower.includes("editorial") ||
    lower.includes("politique") ||
    lower.includes("style")
  ) {
    return "editorial_guidelines";
  }
  if (lower.includes("rubric") || lower.includes("quality")) {
    return "quality_rubric";
  }
  if (lower.includes("instruction") || lower.includes("agent")) {
    return "agent_instructions";
  }
  return "reference";
}

export function documentKindLabel(kind: DocumentKind): string {
  return {
    master_plan: "Master plan",
    editorial_guidelines: "Editorial guidelines",
    agent_instructions: "Agent instructions",
    quality_rubric: "Quality rubric",
    reference: "Reference",
  }[kind];
}

export function formatSize(size: number): string {
  if (size < 1_000) return `${size} B`;
  return `${Math.round(size / 1_000)} KB`;
}
