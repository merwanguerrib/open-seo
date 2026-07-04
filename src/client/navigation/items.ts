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
  Search,
  Sparkles,
  Swords,
  TrendingUp,
} from "lucide-react";
import { linkOptions } from "@tanstack/react-router";

const projectNavItems = [
  {
    to: "/p/$projectId/keywords" as const,
    label: "Keyword Research",
    icon: Search,
    matchSegment: "/keywords",
  },
  {
    to: "/p/$projectId/saved" as const,
    label: "Saved Keywords",
    icon: Bookmark,
    matchSegment: "/saved",
  },
  {
    to: "/p/$projectId/rank-tracking" as const,
    label: "Rank Tracking",
    icon: TrendingUp,
    matchSegment: "/rank-tracking",
  },
  {
    to: "/p/$projectId/content" as const,
    label: "Articles",
    icon: FileText,
    matchSegment: "/content",
  },
  {
    to: "/p/$projectId/domain" as const,
    label: "Domain Overview",
    icon: Globe,
    matchSegment: "/domain",
  },
  {
    to: "/p/$projectId/backlinks" as const,
    label: "Backlinks",
    icon: Link2,
    matchSegment: "/backlinks",
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
    matchSegment: "/audit",
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
    matchSegment: "/brand-lookup",
  },
  {
    to: "/p/$projectId/prompt-explorer" as const,
    label: "Prompt Explorer",
    icon: MessageSquare,
    matchSegment: "/prompt-explorer",
  },
] as const;

const aiNavItem = linkOptions({
  to: "/ai" as const,
  label: "AI & MCP",
  icon: Bot,
  matchSegment: "/ai",
});

function getProjectNavItems(projectId: string) {
  return linkOptions(
    projectNavItems.map((item) => ({
      ...item,
      params: { projectId },
      search: {},
    })),
  );
}

export function getProjectNavGroups(projectId: string) {
  const all = getProjectNavItems(projectId);
  const bySegment = (seg: string) => all.find((i) => i.matchSegment === seg)!;

  return [
    {
      type: "group" as const,
      label: "Keywords",
      icon: Search,
      matchSegments: ["/keywords", "/saved", "/rank-tracking"],
      items: [
        bySegment("/keywords"),
        bySegment("/saved"),
        bySegment("/rank-tracking"),
      ],
    },
    {
      type: "group" as const,
      label: "Content",
      icon: FileText,
      matchSegments: ["/content"],
      items: [bySegment("/content")],
    },
    {
      type: "group" as const,
      label: "Domain",
      icon: Globe,
      matchSegments: ["/domain", "/backlinks", "/serp-competitors", "/audit"],
      items: [
        bySegment("/domain"),
        bySegment("/backlinks"),
        bySegment("/serp-competitors"),
        bySegment("/audit"),
      ],
    },
    {
      type: "group" as const,
      label: "Search Console",
      icon: BarChart3,
      matchSegments: ["/gsc"],
      items: [bySegment("/gsc")],
    },
    {
      type: "group" as const,
      label: "Local",
      icon: MapPin,
      matchSegments: ["/local"],
      items: [bySegment("/local")],
    },
    {
      type: "group" as const,
      label: "AI Visibility",
      icon: Sparkles,
      matchSegments: ["/brand-lookup", "/prompt-explorer"],
      items: [bySegment("/brand-lookup"), bySegment("/prompt-explorer")],
    },
    {
      type: "standalone" as const,
      item: aiNavItem,
    },
  ];
}

export const dataforseoHelpLinkOptions = linkOptions({
  to: "/help/dataforseo-api-key",
});
