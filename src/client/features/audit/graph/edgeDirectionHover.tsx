import { useCallback, useRef, useState } from "react";
import type { buildGraphologyGraph } from "@/client/features/audit/graph/graphologyGraph";

type AuditGraph = ReturnType<typeof buildGraphologyGraph>;

// On node hover, edges are recolored by direction so you can read a page's
// inbound vs outbound internal links at a glance.
const INBOUND_EDGE_COLOR = "#16a34a"; // green — links pointing AT the page
const OUTBOUND_EDGE_COLOR = "#ea580c"; // orange — links FROM the page
const FADED_EDGE_COLOR = "#ededed"; // everything else, dimmed for focus

type HoverInfo = { inbound: number; outbound: number };

/**
 * Tracks the hovered node and exposes a Sigma edgeReducer that colors its
 * edges by direction, plus the in/out counts for the overlay badge. The
 * caller wires `handleEnterNode`/`handleLeaveNode` to Sigma's node events
 * (and refreshes the renderer) so this stays free of any Sigma import.
 */
export function useDirectionalEdgeHover(graph: AuditGraph) {
  const hoveredNodeRef = useRef<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

  const edgeReducer = useCallback(
    (edge: string, data: Record<string, unknown>) => {
      const hovered = hoveredNodeRef.current;
      if (!hovered) return data;
      // Outbound draws above inbound so a reciprocal link still shows its
      // orange (outbound) edge instead of being hidden under the green one.
      if (graph.source(edge) === hovered) {
        return { ...data, color: OUTBOUND_EDGE_COLOR, size: 2, zIndex: 2 };
      }
      if (graph.target(edge) === hovered) {
        return { ...data, color: INBOUND_EDGE_COLOR, size: 2, zIndex: 1 };
      }
      return { ...data, color: FADED_EDGE_COLOR, zIndex: 0 };
    },
    [graph],
  );

  const handleEnterNode = useCallback(
    (node: string) => {
      hoveredNodeRef.current = node;
      setHoverInfo({
        inbound: graph.inDegree(node),
        outbound: graph.outDegree(node),
      });
    },
    [graph],
  );

  const handleLeaveNode = useCallback(() => {
    hoveredNodeRef.current = null;
    setHoverInfo(null);
  }, []);

  return { hoverInfo, edgeReducer, handleEnterNode, handleLeaveNode };
}

/** Overlay showing the hovered page's inbound/outbound internal link counts. */
export function HoverLinkBadge({ info }: { info: HoverInfo }) {
  return (
    <div className="absolute bottom-3 left-3 z-10 rounded-lg bg-base-100/95 px-3 py-2 text-xs shadow-md">
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block size-2.5 rounded-full"
          style={{ backgroundColor: INBOUND_EDGE_COLOR }}
        />
        <span className="tabular-nums font-medium">{info.inbound}</span>
        inbound link{info.inbound === 1 ? "" : "s"}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span
          className="inline-block size-2.5 rounded-full"
          style={{ backgroundColor: OUTBOUND_EDGE_COLOR }}
        />
        <span className="tabular-nums font-medium">{info.outbound}</span>
        outbound link{info.outbound === 1 ? "" : "s"}
      </div>
    </div>
  );
}
