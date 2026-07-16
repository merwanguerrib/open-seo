import {
  BarChart3,
  Bookmark,
  Bot,
  ClipboardCheck,
  FileText,
  Globe,
  Link2,
  MapPin,
  MessageSquare,
  Plane,
  Search,
  Sparkles,
  Swords,
  Terminal,
  TrendingUp,
} from "lucide-react";
import { linkOptions } from "@tanstack/react-router";
import { GoogleGlyphMuted } from "@/client/features/gsc/GoogleGlyph";

const projectNavItems = [
  {
    to: "/p/$projectId/keywords" as const,
    label: "Keyword Research",
    icon: Search,
  },
  {
    to: "/p/$projectId/saved" as const,
    label: "Saved Keywords",
    icon: Bookmark,
  },
  {
    to: "/p/$projectId/rank-tracking" as const,
    label: "Rank Tracking",
    icon: TrendingUp,
  },
  {
    to: "/p/$projectId/search-performance" as const,
    label: "GSC Insights",
    icon: GoogleGlyphMuted,
  },
  {
    to: "/p/$projectId/content" as const,
    label: "Articles",
    icon: FileText,
    matchSegment: "/content",
  },
  {
    to: "/p/$projectId/autopilot" as const,
    label: "Autopilot",
    icon: Plane,
    matchSegment: "/autopilot",
  },
  {
    to: "/p/$projectId/domain" as const,
    label: "Domain Overview",
    icon: Globe,
  },
  {
    to: "/p/$projectId/backlinks" as const,
    label: "Backlinks",
    icon: Link2,
  },
  {
    to: "/p/$projectId/serp-competitors" as const,
    label: "SERP Competitors",
    icon: Swords,
    matchSegment: "/serp-competitors",
  },
  {
    to: "/p/$projectId/audit" as const,
    label: "Site Audit",
    icon: ClipboardCheck,
  },
  {
    to: "/p/$projectId/gsc" as const,
    label: "Search Console",
    icon: BarChart3,
    matchSegment: "/gsc",
  },
  {
    to: "/p/$projectId/local" as const,
    label: "Local SEO",
    icon: MapPin,
    matchSegment: "/local",
  },
  {
    to: "/p/$projectId/brand-lookup" as const,
    label: "Brand Lookup",
    icon: Sparkles,
  },
  {
    to: "/p/$projectId/prompt-explorer" as const,
    label: "Prompt Explorer",
    icon: MessageSquare,
  },
  {
    to: "/p/$projectId/tools" as const,
    label: "MCP Tools",
    icon: Terminal,
    matchSegment: "/tools",
  },
] as const;

const aiNavItem = linkOptions({
  to: "/ai" as const,
  label: "AI & MCP",
  icon: Bot,
});

// Always-visible sidebar group (not project-scoped, unlike the groups below).
export const connectNavGroup = {
  label: "Connect",
  items: [aiNavItem],
};

function getProjectNavItems(projectId: string) {
  return linkOptions(
    projectNavItems.map((item) => ({
      ...item,
      params: { projectId },
      search: {},
    })),
  );
}

// Grouped by scope: "My Site" is the project's own domain (tracked data),
// "Research" is point-at-anything lookup tools.
export function getProjectNavGroups(projectId: string) {
  const all = getProjectNavItems(projectId);
  const byPath = (path: (typeof projectNavItems)[number]["to"]) =>
    all.find((i) => i.to === path)!;

  return [
    {
      label: "Research",
      items: [
        byPath("/p/$projectId/keywords"),
        byPath("/p/$projectId/domain"),
        byPath("/p/$projectId/backlinks"),
        byPath("/p/$projectId/serp-competitors"),
        byPath("/p/$projectId/brand-lookup"),
        byPath("/p/$projectId/prompt-explorer"),
      ],
    },
    {
      label: "My Site",
      items: [
        byPath("/p/$projectId/search-performance"),
        byPath("/p/$projectId/rank-tracking"),
        byPath("/p/$projectId/saved"),
        byPath("/p/$projectId/audit"),
      ],
    },
    {
      label: "Content",
      items: [byPath("/p/$projectId/content"), byPath("/p/$projectId/autopilot")],
    },
    {
      label: "Tools",
      items: [
        // GSC insights currently exist as two parallel pages (search-performance
        // above, and this one) — kept side by side pending a follow-up dedupe.
        byPath("/p/$projectId/gsc"),
        byPath("/p/$projectId/local"),
        byPath("/p/$projectId/tools"),
      ],
    },
  ];
}

export const dataforseoHelpLinkOptions = linkOptions({
  to: "/help/dataforseo-api-key",
});
