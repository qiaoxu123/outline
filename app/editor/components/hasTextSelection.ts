import type { EditorState } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";

/**
 * The toolbar's extension may briefly report an inactive state during mouse
 * selection in Electron. The actual ProseMirror text range is authoritative.
 * Ignore empty/whitespace-only ranges and structural selections.
 */
export function hasTextSelection(state: EditorState): boolean {
  const { doc, selection } = state;
  return (
    selection instanceof TextSelection &&
    !selection.empty &&
    doc.textBetween(selection.from, selection.to, " ").trim().length > 0
  );
}
