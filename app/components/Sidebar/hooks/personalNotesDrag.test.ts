import { describe, expect, it } from "vitest";
import {
  canAttemptPersonalNotesMove,
  canStartPersonalNotesDrag,
} from "./personalNotesDrag";

describe("Personal tree drag permissions", () => {
  it("allows a published navigation node to start dragging before its full Document loads", () => {
    expect(
      canStartPersonalNotesDrag({
        isEditing: false,
        hasPersonalCollection: true,
      })
    ).toBe(true);
  });

  it("does not allow editing or inactive notes to initiate a drag", () => {
    expect(
      canStartPersonalNotesDrag({
        isEditing: true,
        hasPersonalCollection: true,
      })
    ).toBe(false);
    expect(
      canStartPersonalNotesDrag({
        isEditing: false,
        isActive: false,
        hasPersonalCollection: true,
      })
    ).toBe(false);
  });

  it("does not grant an optimistic move outside the Personal tree", () => {
    expect(
      canStartPersonalNotesDrag({
        isEditing: false,
        hasPersonalCollection: false,
      })
    ).toBe(false);
    expect(canAttemptPersonalNotesMove(false, undefined)).toBe(false);
  });

  it("respects explicitly denied move permissions, while missing permissions are checked by the server", () => {
    expect(
      canStartPersonalNotesDrag({
        isEditing: false,
        hasPersonalCollection: true,
        knownMovePermission: false,
      })
    ).toBe(false);
    expect(canAttemptPersonalNotesMove(true, false)).toBe(false);
    expect(canAttemptPersonalNotesMove(true, true)).toBe(true);
    expect(canAttemptPersonalNotesMove(true, undefined)).toBe(true);
  });
});
