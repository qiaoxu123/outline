import { describe, expect, test } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { hasTextSelection } from "./hasTextSelection";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: { group: "inline" },
  },
});

const stateWith = (text: string, from: number, to: number) => {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text(text)),
  ]);
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, from, to),
  });
};

describe("hasTextSelection", () => {
  test("recognizes non-empty mouse and keyboard text ranges", () => {
    expect(hasTextSelection(stateWith("selected text", 1, 9))).toBe(true);
  });

  test("does not show toolbar for a cursor or only whitespace", () => {
    expect(hasTextSelection(stateWith("selected text", 1, 1))).toBe(false);
    expect(hasTextSelection(stateWith("a   b", 2, 5))).toBe(false);
  });

  test("does not confuse structural node selection with selected text", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("text")),
    ]);
    const state = EditorState.create({
      schema,
      doc,
      selection: NodeSelection.create(doc, 0),
    });
    expect(hasTextSelection(state)).toBe(false);
  });
});
