/**
 * Personal documents can appear in a collection navigation tree before their
 * full Document models and move policies are hydrated. Permit an optimistic
 * drop only for these verified collection-tree entries and only while there
 * is no explicit policy denying the move. The documents.move API remains the
 * authoritative permissions and ancestry check.
 */
export function canAttemptPersonalNotesMove(
  fromPersonalCollectionTree: boolean,
  knownMovePermission?: boolean
): boolean {
  if (knownMovePermission !== undefined) {
    return knownMovePermission;
  }
  return fromPersonalCollectionTree;
}

export function canStartPersonalNotesDrag({
  isEditing,
  isActive,
  hasPersonalCollection,
  knownMovePermission,
}: {
  isEditing: boolean;
  isActive?: boolean;
  hasPersonalCollection: boolean;
  knownMovePermission?: boolean;
}): boolean {
  if (isEditing || isActive === false) {
    return false;
  }
  if (isActive === true) {
    return true;
  }
  return (
    hasPersonalCollection &&
    canAttemptPersonalNotesMove(true, knownMovePermission)
  );
}
