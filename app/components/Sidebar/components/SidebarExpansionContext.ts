import { action, observable } from "mobx";
import { createContext, useContext, useEffect, useState } from "react";
import type { NavigationNode } from "@shared/types";

/**
 * Computes the set of node IDs along the path from any node in `roots` down
 * to a node with `targetId`, inclusive of both endpoints. Returns an empty
 * array when no path exists.
 *
 * @param roots the top-level navigation nodes to search through.
 * @param targetId the id of the target document.
 * @returns array of ancestor IDs (inclusive of the target).
 */
function computeAncestorPath(
  roots: NavigationNode[],
  targetId: string
): string[] {
  const stack: string[] = [];
  let found = false;
  const search = (nodes: NavigationNode[]): boolean => {
    for (const node of nodes) {
      stack.push(node.id);
      if (node.id === targetId) {
        found = true;
        return true;
      }
      if (node.children.length && search(node.children)) {
        return true;
      }
      stack.pop();
    }
    return false;
  };
  search(roots);
  return found ? stack : [];
}

/**
 * Manages the set of expanded node IDs for a sidebar document tree.
 *
 * Uses a MobX ObservableSet so that individual `observer`-wrapped
 * DocumentLinks only re-render when their own node's membership in the set
 * changes, rather than on every expansion toggle anywhere in the tree.
 */
export class SidebarExpansionState {
  @observable
  expandedIds = new Set<string>();

  private autoExpandedIds = new Set<string>();

  /**
   * Whether a given node is currently expanded.
   *
   * @param nodeId the id of the node to check.
   * @returns true if the node is expanded.
   */
  isExpanded(nodeId: string): boolean {
    return this.expandedIds.has(nodeId);
  }

  /**
   * Expand a single node.
   *
   * @param nodeId the id of the node to expand.
   */
  @action
  expand(nodeId: string): void {
    this.expandedIds.add(nodeId);
    this.autoExpandedIds.delete(nodeId);
  }

  /**
   * Collapse a single node.
   *
   * @param nodeId the id of the node to collapse.
   */
  @action
  collapse(nodeId: string): void {
    this.expandedIds.delete(nodeId);
    this.autoExpandedIds.delete(nodeId);
  }

  /**
   * Expand a node and all of its descendants recursively.
   *
   * @param node the root NavigationNode to expand.
   */
  @action
  expandDescendants(node: NavigationNode): void {
    const walk = (n: NavigationNode) => {
      this.expandedIds.add(n.id);
      this.autoExpandedIds.delete(n.id);
      for (const child of n.children) {
        walk(child);
      }
    };
    walk(node);
  }

  /**
   * Collapse a node and all of its descendants recursively.
   *
   * @param node the root NavigationNode to collapse.
   */
  @action
  collapseDescendants(node: NavigationNode): void {
    const walk = (n: NavigationNode) => {
      this.expandedIds.delete(n.id);
      this.autoExpandedIds.delete(n.id);
      for (const child of n.children) {
        walk(child);
      }
    };
    walk(node);
  }

  /**
   * Expand all nodes along a path (e.g. ancestors of the active document).
   *
   * @param ids the node IDs to expand.
   */
  @action
  syncAutoExpandedPath(ids: Iterable<string>): void {
    const path = new Set(ids);
    for (const id of this.autoExpandedIds) {
      if (!path.has(id)) {
        this.expandedIds.delete(id);
      }
    }

    const nextAutoExpandedIds = new Set<string>();
    for (const id of path) {
      if (!this.expandedIds.has(id)) {
        this.expandedIds.add(id);
        nextAutoExpandedIds.add(id);
      } else if (this.autoExpandedIds.has(id)) {
        nextAutoExpandedIds.add(id);
      }
    }
    this.autoExpandedIds = nextAutoExpandedIds;
  }

  /**
   * Expand every node in the given roots, recursively.
   *
   * @param roots the top-level navigation nodes.
   */
  @action
  expandAll(roots: NavigationNode[]): void {
    const walk = (nodes: NavigationNode[]) => {
      for (const node of nodes) {
        this.expandedIds.add(node.id);
        this.autoExpandedIds.delete(node.id);
        walk(node.children);
      }
    };
    walk(roots);
  }

  /**
   * Collapse every node by clearing the set.
   */
  @action
  collapseAll(): void {
    this.expandedIds.clear();
    this.autoExpandedIds.clear();
  }
}

/**
 * Context for providing a SidebarExpansionState to descendant sidebar
 * components. Each document tree root (collection, starred doc, shared
 * membership) creates its own instance so expansion state is scoped.
 */
const SidebarExpansionContext = createContext<SidebarExpansionState | null>(
  null
);

/**
 * Hook to consume the nearest SidebarExpansionState from context.
 *
 * @returns the expansion state instance.
 */
export function useSidebarExpansion(): SidebarExpansionState {
  const ctx = useContext(SidebarExpansionContext);
  if (!ctx) {
    throw new Error(
      "useSidebarExpansion must be used within a SidebarExpansionContext.Provider"
    );
  }
  return ctx;
}

/**
 * Hook that creates a SidebarExpansionState and auto-expands the path
 * to the active document whenever it changes. Returns the state instance
 * to be provided via SidebarExpansionContext.Provider.
 *
 * @param roots the top-level navigation nodes (e.g. collection documents).
 * @param activeDocumentId the currently active document ID.
 * @returns the expansion state instance.
 */
export function useSidebarExpansionState(
  roots: NavigationNode[] | undefined,
  activeDocumentId: string | undefined
): SidebarExpansionState {
  const [state] = useState(() => new SidebarExpansionState());

  useEffect(() => {
    if (!roots) {
      return;
    }
    const path = activeDocumentId
      ? computeAncestorPath(roots, activeDocumentId)
      : [];
    state.syncAutoExpandedPath(path);
  }, [state, roots, activeDocumentId]);

  return state;
}

export default SidebarExpansionContext;
