export const HIGHLIGHT_COLOR = "#ef4444"; // red-500
export const DIMMED_COLOR = "#e5e7eb"; // gray-200

export function nodeHighlightReducer(
  isHighlighted: boolean,
  anyHighlighted: boolean,
): { color?: string; zIndex?: number } {
  if (!anyHighlighted) return {};
  return isHighlighted
    ? { color: HIGHLIGHT_COLOR, zIndex: 1 }
    : { color: DIMMED_COLOR, zIndex: 0 };
}
