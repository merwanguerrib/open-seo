import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { MapPin, Star } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getLocalSerp,
  searchLocalBusinesses,
  type LocalBusinessRow,
  type LocalSerpRow,
} from "@/serverFunctions/local";

type Tab = "rankings" | "businesses";

export function LocalSeoPage({ projectId }: { projectId: string }) {
  const [tab, setTab] = React.useState<Tab>("rankings");
  const [latitude, setLatitude] = React.useState("");
  const [longitude, setLongitude] = React.useState("");
  const [keyword, setKeyword] = React.useState("");

  const coords = parseCoords(latitude, longitude);

  const rankingsMutation = useMutation({
    mutationFn: () =>
      getLocalSerp({
        data: {
          projectId,
          keyword: keyword.trim(),
          latitude: coords!.latitude,
          longitude: coords!.longitude,
        },
      }),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to load rankings")),
  });

  const businessesMutation = useMutation({
    mutationFn: () =>
      searchLocalBusinesses({
        data: {
          projectId,
          query: keyword.trim(),
          latitude: coords!.latitude,
          longitude: coords!.longitude,
        },
      }),
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(error, "Failed to search businesses"),
      ),
  });

  const activeMutation =
    tab === "rankings" ? rankingsMutation : businessesMutation;
  const canSubmit = coords !== null && keyword.trim().length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Local SEO</h1>
        <p className="text-sm text-base-content/70">
          Google Maps rankings and business listings around a location
        </p>
      </div>

      <div role="tablist" className="tabs tabs-border w-fit">
        <button
          role="tab"
          type="button"
          className={`tab ${tab === "rankings" ? "tab-active" : ""}`}
          onClick={() => setTab("rankings")}
        >
          Local rankings
        </button>
        <button
          role="tab"
          type="button"
          className={`tab ${tab === "businesses" ? "tab-active" : ""}`}
          onClick={() => setTab("businesses")}
        >
          Business search
        </button>
      </div>

      <form
        className="card bg-base-100 border border-base-300"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) activeMutation.mutate();
        }}
      >
        <div className="card-body gap-3 p-4">
          <label className="form-control">
            <span className="label-text text-xs">
              {tab === "rankings"
                ? "Keyword (e.g. plombier, coffee shop)"
                : "Business name or category"}
            </span>
            <input
              className="input input-bordered input-sm"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={tab === "rankings" ? "coffee shop" : "coffee"}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="form-control">
              <span className="label-text text-xs">Latitude</span>
              <input
                className="input input-bordered input-sm font-mono"
                value={latitude}
                onChange={(event) => setLatitude(event.target.value)}
                placeholder="48.8566"
                inputMode="decimal"
              />
            </label>
            <label className="form-control">
              <span className="label-text text-xs">Longitude</span>
              <input
                className="input input-bordered input-sm font-mono"
                value={longitude}
                onChange={(event) => setLongitude(event.target.value)}
                placeholder="2.3522"
                inputMode="decimal"
              />
            </label>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-base-content/60">
              Enter the coordinate to search from. Tip: right-click a spot in
              Google Maps to copy its lat, lng.
            </p>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!canSubmit || activeMutation.isPending}
            >
              {activeMutation.isPending && (
                <span className="loading loading-spinner loading-xs" />
              )}
              {tab === "rankings" ? "Get rankings" : "Search"}
            </button>
          </div>
        </div>
      </form>

      {activeMutation.isPending ? (
        <div className="flex justify-center p-10">
          <span className="loading loading-spinner loading-md" />
        </div>
      ) : tab === "rankings" && rankingsMutation.data ? (
        <LocalRankingsTable rows={rankingsMutation.data.results} />
      ) : tab === "businesses" && businessesMutation.data ? (
        <LocalBusinessesTable rows={businessesMutation.data.businesses} />
      ) : null}
    </div>
  );
}

function parseCoords(
  latitude: string,
  longitude: string,
): { latitude: number; longitude: number } | null {
  const lat = Number.parseFloat(latitude);
  const lng = Number.parseFloat(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

function RatingCell({
  rating,
  votes,
}: {
  rating: number | null;
  votes: number | null;
}) {
  if (rating == null) return <span className="text-base-content/40">—</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Star className="size-3.5 fill-warning text-warning" />
      {rating.toFixed(1)}
      {votes != null && <span className="text-base-content/50">({votes})</span>}
    </span>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body items-center gap-2 p-10 text-center">
        <MapPin className="size-8 text-base-content/30" />
        <p className="text-sm text-base-content/60">{label}</p>
      </div>
    </div>
  );
}

function LocalRankingsTable({ rows }: { rows: LocalSerpRow[] }) {
  if (rows.length === 0) return <EmptyState label="No Maps results here." />;
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body p-0">
        <div className="overflow-x-auto">
          <table className="table table-zebra table-sm">
            <thead>
              <tr>
                <th className="w-12">#</th>
                <th>Business</th>
                <th>Rating</th>
                <th>Address</th>
                <th>Website</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.title}-${index}`}>
                  <td className="tabular-nums">{row.rank ?? index + 1}</td>
                  <td className="font-medium">{row.title}</td>
                  <td>
                    <RatingCell rating={row.rating} votes={row.votes} />
                  </td>
                  <td
                    className="max-w-xs truncate text-xs text-base-content/70"
                    title={row.address ?? undefined}
                  >
                    {row.address ?? "—"}
                  </td>
                  <td className="text-xs">{row.domain ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function LocalBusinessesTable({ rows }: { rows: LocalBusinessRow[] }) {
  if (rows.length === 0)
    return <EmptyState label="No businesses found here." />;
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body p-0">
        <div className="overflow-x-auto">
          <table className="table table-zebra table-sm">
            <thead>
              <tr>
                <th>Business</th>
                <th>Category</th>
                <th>Rating</th>
                <th>Address</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.title}-${index}`}>
                  <td className="font-medium">{row.title}</td>
                  <td className="text-xs text-base-content/70">
                    {row.category ?? "—"}
                  </td>
                  <td>
                    <RatingCell rating={row.rating} votes={row.votes} />
                  </td>
                  <td
                    className="max-w-xs truncate text-xs text-base-content/70"
                    title={row.address ?? undefined}
                  >
                    {row.address ?? "—"}
                  </td>
                  <td className="whitespace-nowrap text-xs">
                    {row.phone ?? "—"}
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
