/**
 * Persistence for savings goals (US-P4-B), in its own local store key
 * (`mtrb.goals`), encrypted at rest with the session key (store-crypto). Kept
 * separate from the synced vault + categorization (like budgets, DECISIONS D14);
 * cross-device sync folds into the future synced-blob task (#79). Money is bigint
 * cents, serialized as decimal strings.
 */
import { encodeStateForStorage, decodeStateFromStorage } from './store-crypto';
import type { SavingsGoal } from '../app/savings-goal';

const LS_KEY = 'mtrb.goals';

interface StoredGoal {
  id: string;
  name: string;
  target_minor: string;
  saved_minor: string;
  deadline?: string;
}

/** Load saved goals; empty if absent, unparseable, or locked. */
export async function loadGoals(): Promise<SavingsGoal[]> {
  if (typeof localStorage === 'undefined') return [];
  const stored = localStorage.getItem(LS_KEY);
  if (stored === null) return [];
  const decoded = await decodeStateFromStorage(stored);
  if (decoded.kind === 'locked') return [];
  try {
    const parsed = JSON.parse(decoded.json) as StoredGoal[];
    if (!Array.isArray(parsed)) return [];
    const out: SavingsGoal[] = [];
    for (const g of parsed) {
      try {
        const goal: SavingsGoal = {
          id: g.id,
          name: g.name,
          target_minor: BigInt(g.target_minor),
          saved_minor: BigInt(g.saved_minor)
        };
        if (typeof g.deadline === 'string') goal.deadline = g.deadline;
        out.push(goal);
      } catch {
        // skip a corrupt entry rather than failing the whole load
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Persist goals, encrypted at rest when a session key is loaded. */
export async function saveGoals(goals: readonly SavingsGoal[]): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  const obj: StoredGoal[] = goals.map((g) => {
    const s: StoredGoal = {
      id: g.id,
      name: g.name,
      target_minor: g.target_minor.toString(),
      saved_minor: g.saved_minor.toString()
    };
    if (g.deadline !== undefined) s.deadline = g.deadline;
    return s;
  });
  localStorage.setItem(LS_KEY, await encodeStateForStorage(JSON.stringify(obj)));
}
