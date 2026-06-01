/**
 * Hierarchical spending-by-category roll-up (Hemanth's ask: a high-level view
 * where clicking a category opens its sub-categories, and sub-sub-categories,
 * down to the transactions). Pure: no I/O, no Svelte, no Date.now(). Money is
 * bigint cents.
 *
 * Input: the flat `Category[]` (each may carry a `parent_id`, so the tree can
 * nest to any depth) + a `Map<categoryId|null, bigint>` of DIRECT spend per
 * category (null = uncategorized). Output: a forest of nodes where every node
 * knows its OWN direct spend and its rolled TOTAL (own + all descendants).
 */
import type { Category } from './categorization';

/** Pseudo-id for the "uncategorized" bucket (spend with category_id null). */
export const UNCATEGORIZED_ID = '__uncategorized__';

export interface CatNode {
  id: string;
  name: string;
  parentId: string | null;
  /** Direct spend tagged to THIS category, in cents. */
  ownMinor: bigint;
  /** own + every descendant's spend, in cents. */
  totalMinor: bigint;
  children: CatNode[];
  /** True when at least one child has non-zero rolled spend (→ drillable). */
  hasChildrenWithSpend: boolean;
}

/**
 * Build the category forest with rolled-up spend. Categories whose parent is
 * missing (or null) become roots. Spend tagged to an unknown category id is
 * still counted (as a root) so no money is lost. Returns ALL roots (including
 * zero-spend ones); callers filter by `totalMinor > 0`.
 */
export function buildCategoryTree(
  categories: readonly Category[],
  spendByCatId: ReadonlyMap<string | null, bigint>,
  nameOf: (id: string | null) => string
): CatNode[] {
  const nodes = new Map<string, CatNode>();
  const ensure = (id: string, name: string, parentId: string | null): CatNode => {
    let n = nodes.get(id);
    if (n === undefined) {
      n = {
        id,
        name,
        parentId,
        ownMinor: 0n,
        totalMinor: 0n,
        children: [],
        hasChildrenWithSpend: false
      };
      nodes.set(id, n);
    }
    return n;
  };

  for (const c of categories) ensure(c.id, c.name, c.parent_id ?? null);

  for (const [id, amt] of spendByCatId) {
    if (amt <= 0n) continue;
    if (id === null) {
      ensure(UNCATEGORIZED_ID, nameOf(null), null).ownMinor += amt;
      continue;
    }
    ensure(id, nameOf(id), null).ownMinor += amt; // unknown id → treated as a root below
  }

  const roots: CatNode[] = [];
  for (const n of nodes.values()) {
    if (n.parentId !== null && nodes.has(n.parentId)) {
      nodes.get(n.parentId)!.children.push(n);
    } else {
      roots.push(n);
    }
  }

  // Defensive (money-truth): a parent_id cycle (A→B→A) or self-parent (X→X)
  // leaves nodes reachable from NO root, which would silently drop their spend
  // from the top-level sum. Promote any such node to a root so conservation
  // still holds. Unreachable through today's UI (parent_id is only assigned at
  // creation, always to an already-existing parent, with no reparenting surface)
  // — but corrupt/merged persisted data could reach it, and losing a cent in
  // money-truth code is not acceptable.
  const reachable = new Set<string>();
  const mark = (n: CatNode): void => {
    if (reachable.has(n.id)) return;
    reachable.add(n.id);
    for (const c of n.children) mark(c);
  };
  for (const r of roots) mark(r);
  for (const n of nodes.values()) {
    if (!reachable.has(n.id)) {
      roots.push(n);
      mark(n); // mark its subtree so the rest of a cycle isn't promoted too
    }
  }

  // `seen` guarantees termination if a cycle was promoted above; each node's
  // spend is still counted exactly once.
  const rollup = (n: CatNode, seen: Set<string>): bigint => {
    if (seen.has(n.id)) return 0n;
    seen.add(n.id);
    let t = n.ownMinor;
    for (const c of n.children) t += rollup(c, seen);
    n.totalMinor = t;
    n.hasChildrenWithSpend = n.children.some((c) => c.totalMinor > 0n);
    return t;
  };
  for (const r of roots) rollup(r, new Set<string>());

  return roots;
}

/** Find a node anywhere in the forest by id. Cycle-safe (terminates on a
 *  malformed parent_id cycle). */
export function findNode(roots: readonly CatNode[], id: string): CatNode | null {
  return findNodeSeen(roots, id, new Set<string>());
}
function findNodeSeen(roots: readonly CatNode[], id: string, seen: Set<string>): CatNode | null {
  for (const r of roots) {
    if (r.id === id) return r;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const f = findNodeSeen(r.children, id, seen);
    if (f !== null) return f;
  }
  return null;
}

/** The breadcrumb path (root → … → node) to a node, or [] if not found.
 *  Cycle-safe. */
export function pathTo(roots: readonly CatNode[], id: string): CatNode[] {
  return pathToSeen(roots, id, new Set<string>());
}
function pathToSeen(roots: readonly CatNode[], id: string, seen: Set<string>): CatNode[] {
  for (const r of roots) {
    if (r.id === id) return [r];
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const sub = pathToSeen(r.children, id, seen);
    if (sub.length > 0) return [r, ...sub];
  }
  return [];
}

/** Children of a node (or the roots when id is null), ranked by total desc and
 *  filtered to non-zero spend — the rows shown at one level of the drill. */
export function levelRows(roots: readonly CatNode[], id: string | null): CatNode[] {
  const list = id === null ? roots : (findNode(roots, id)?.children ?? []);
  return [...list]
    .filter((n) => n.totalMinor > 0n)
    .sort((a, b) => {
      // Rank by rolled total desc; tie-break by name so equal totals get a
      // deterministic order. (A comparator that never returns 0 is invalid and
      // leaves ties in engine-defined order — two equal subscriptions would
      // shuffle on different inputs.)
      if (a.totalMinor !== b.totalMinor) return b.totalMinor > a.totalMinor ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
}

/** Sum of a set of nodes' totals (e.g. for an "Other" bucket). */
export function sumTotals(nodes: readonly CatNode[]): bigint {
  let t = 0n;
  for (const n of nodes) t += n.totalMinor;
  return t;
}
