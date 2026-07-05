/**
 * Pure decision logic for the weekly GSC self-repair pass. Given an article's
 * performance snapshots over time, decide what (if anything) to do. Kept
 * side-effect free so the thresholds are unit-testable.
 */

export type ArticleMetricPoint = {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type RepairAction =
  | "none"
  | "title_rewrite"
  | "refresh"
  | "internal_links"
  | "archive";

// A page with many impressions but few clicks has a title/snippet problem.
const LOW_CTR_THRESHOLD = 0.02;
const LOW_CTR_MIN_IMPRESSIONS = 100;
// Positions 11-20 = page 2: a push (refresh + links) can reach page 1.
const PAGE_TWO_MIN = 11;
const PAGE_TWO_MAX = 20;
// A meaningful downward drift in average position between the first and last
// snapshot = content decay.
const DECAY_POSITION_DELTA = 5;
// Old + effectively invisible = dead.
const ARCHIVE_MIN_AGE_DAYS = 56; // 8 weeks
const ARCHIVE_MAX_IMPRESSIONS = 3;

export function decideRepairAction(input: {
  publishedAt: string | null;
  now: Date;
  metrics: ArticleMetricPoint[];
}): RepairAction {
  const { metrics } = input;
  if (metrics.length === 0) return "none";

  const latest = metrics[metrics.length - 1];
  const earliest = metrics[0];

  const ageDays = input.publishedAt
    ? (input.now.getTime() - new Date(input.publishedAt).getTime()) /
      (24 * 60 * 60 * 1000)
    : 0;

  // Dead article: old and essentially no impressions in the latest window.
  if (
    ageDays >= ARCHIVE_MIN_AGE_DAYS &&
    latest.impressions <= ARCHIVE_MAX_IMPRESSIONS
  ) {
    return "archive";
  }

  // Title/snippet problem: lots of impressions, few clicks.
  if (
    latest.impressions >= LOW_CTR_MIN_IMPRESSIONS &&
    latest.ctr < LOW_CTR_THRESHOLD
  ) {
    return "title_rewrite";
  }

  // Content decay: average position drifted meaningfully worse over time.
  if (
    metrics.length >= 2 &&
    latest.position - earliest.position >= DECAY_POSITION_DELTA
  ) {
    return "refresh";
  }

  // Stuck on page 2 with real demand: strengthen internal links to push up.
  if (
    latest.position >= PAGE_TWO_MIN &&
    latest.position <= PAGE_TWO_MAX &&
    latest.impressions >= LOW_CTR_MIN_IMPRESSIONS
  ) {
    return "internal_links";
  }

  return "none";
}
