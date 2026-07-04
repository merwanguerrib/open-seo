import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { requireProjectContext } from "@/serverFunctions/middleware";

const coordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const businessSearchSchema = coordinateSchema.extend({
  projectId: z.string().min(1),
  query: z.string().min(1).max(200),
  radiusKm: z.number().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const localSerpSchema = coordinateSchema.extend({
  projectId: z.string().min(1),
  keyword: z.string().min(1).max(200),
  zoom: z.number().int().min(4).max(18).optional(),
});

export type LocalBusinessRow = {
  title: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  domain: string | null;
  rating: number | null;
  votes: number | null;
};

export type LocalSerpRow = {
  rank: number | null;
  title: string;
  rating: number | null;
  votes: number | null;
  address: string | null;
  domain: string | null;
  phone: string | null;
};

function formatCoordinate(value: number): string {
  return value.toFixed(7).replace(/\.?0+$/, "");
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** Extract { value, votes_count } from a DataForSEO RatingInfo-shaped field. */
function ratingOf(value: unknown): {
  rating: number | null;
  votes: number | null;
} {
  if (typeof value !== "object" || value === null) {
    return { rating: null, votes: null };
  }
  const record = value as Record<string, unknown>;
  return {
    rating: asNumber(record.value),
    votes: asNumber(record.votes_count),
  };
}

/** Find business listings near a coordinate (Google Business Profile data). */
export const searchLocalBusinesses = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => businessSearchSchema.parse(data))
  .handler(async ({ data, context }) => {
    const client = createDataforseoClient(context);
    const radiusKm = data.radiusKm ?? 10;
    const locationCoordinate = `${formatCoordinate(data.latitude)},${formatCoordinate(data.longitude)},${radiusKm}`;

    const items = await client.business.businessListings({
      title: data.query,
      locationCoordinate,
      limit: data.limit ?? 50,
      orderBy: ["rating.value,desc"],
      creditFeature: "local_seo",
    });

    const rows: LocalBusinessRow[] = items.map((raw) => {
      const item = raw as Record<string, unknown>;
      const { rating, votes } = ratingOf(item.rating);
      return {
        title: asString(item.title) ?? "(untitled)",
        category: asString(item.category),
        address: asString(item.address),
        phone: asString(item.phone),
        domain: asString(item.domain),
        rating,
        votes,
      };
    });

    return { businesses: rows };
  });

/** Fetch one Google Maps SERP for a keyword at a coordinate. */
export const getLocalSerp = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .inputValidator((data: unknown) => localSerpSchema.parse(data))
  .handler(async ({ data, context }) => {
    const client = createDataforseoClient(context);
    const coordinate = `${formatCoordinate(data.latitude)},${formatCoordinate(data.longitude)}`;
    const locationCoordinate =
      data.zoom == null ? coordinate : `${coordinate},${data.zoom}z`;

    const items = await client.serp.local({
      keyword: data.keyword,
      locationCoordinate,
      languageCode: context.project.languageCode,
      searchType: "maps",
      device: "desktop",
      depth: 20,
      creditFeature: "local_seo",
    });

    const rows: LocalSerpRow[] = items.map((raw) => {
      const item = raw as Record<string, unknown>;
      const { rating, votes } = ratingOf(item.rating);
      return {
        rank: asNumber(item.rank_absolute) ?? asNumber(item.rank_group),
        title: asString(item.title) ?? "(untitled)",
        rating,
        votes,
        address: asString(item.address),
        domain: asString(item.domain),
        phone: asString(item.phone),
      };
    });

    return { results: rows };
  });
