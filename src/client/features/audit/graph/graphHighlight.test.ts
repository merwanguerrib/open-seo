import { describe, it, expect } from "vitest";
import { nodeHighlightReducer, HIGHLIGHT_COLOR, DIMMED_COLOR } from "./graphHighlight";

describe("nodeHighlightReducer", () => {
  it("returns no override when nothing is highlighted", () => {
    expect(nodeHighlightReducer(false, false)).toEqual({});
  });
  it("accents highlighted nodes", () => {
    expect(nodeHighlightReducer(true, true)).toEqual({
      color: HIGHLIGHT_COLOR,
      zIndex: 1,
    });
  });
  it("dims non-highlighted nodes when a selection is active", () => {
    expect(nodeHighlightReducer(false, true)).toEqual({
      color: DIMMED_COLOR,
      zIndex: 0,
    });
  });
});
