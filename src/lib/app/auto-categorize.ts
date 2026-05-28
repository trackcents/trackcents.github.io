/**
 * Three-tier auto-categorisation for fresh / un-annotated transactions.
 *
 * This is what turns "everything shows Uncategorised" (Hemanth's complaint
 * tonight) into "most things show a sensible category and you only have to
 * touch the edge cases."
 *
 *   1. User-defined rules (`firstMatchingRule` via `applyRules`)
 *      → strongest signal, because the user wrote them explicitly.
 *   2. Built-in keyword fallback (`guessCategoryId`)
 *      → covers everyday merchants for both India and the US (chai → Food,
 *      uber → Transport, EMI → Loans, …) without any history.
 *   3. Self-learning naive-Bayes classifier (`predictCategory`)
 *      → learns from the user's OWN annotated history each session.  The more
 *      they tag, the smarter it gets.  Never asked to guess until at least 2
 *      distinct labels + 4 samples exist.
 *
 * Manual annotations are ALWAYS preserved (sticky) — the user's explicit
 * choice always wins.  Tier-2 and tier-3 results are written as `source:
 * 'rule'`, so they're treated as mutable just like a real rule match.
 *
 * Pure: returns a NEW map; the input map is not mutated.
 */
import {
  applyRules,
  transactionCategoryKey,
  type CategorizableTransaction,
  type Category,
  type CategoryRule,
  type TransactionAnnotation
} from './categorization';
import { guessCategoryId } from './category-guess';
import { predictCategory, trainFromAnnotations, type ClassifierState } from './category-classifier';
import type { ImportRecord } from '../db/store';
import type { CategorizationState } from '../db/categorization-store';

export function autoCategorize(
  transactions: CategorizableTransaction[],
  categories: Category[],
  rules: CategoryRule[],
  existing: ReadonlyMap<string, TransactionAnnotation>,
  classifier?: ClassifierState
): Map<string, TransactionAnnotation> {
  // Tier 1: user rules.  applyRules does the right thing with manual stickiness
  // + carries forward extras (notes/tags/etc.) for both batched and untouched
  // transactions.  This is the existing, tested machinery — we just wrap it.
  const next = applyRules(rules, transactions, existing);

  // Tier 2 + 3: for each tx that ended up uncategorised AND isn't a manual pin,
  // try the keyword guess, then the classifier.  First non-null wins.
  for (const tx of transactions) {
    const ann = next.get(tx.key);
    if (ann?.source === 'manual') continue; // sticky: do not override
    if (ann?.category_id !== null && ann?.category_id !== undefined) continue; // already tagged

    let guess: string | null = guessCategoryId(tx.description, categories, rules);
    if (guess === null && classifier !== undefined) {
      const predicted = predictCategory(classifier, tx.description);
      // Defensive: classifier might still hold a category id that the user
      // has since deleted — verify before trusting it.
      if (predicted !== null && categories.some((c) => c.id === predicted)) {
        guess = predicted;
      }
    }

    if (guess !== null) {
      const base: TransactionAnnotation = ann ?? { category_id: null, source: 'rule' };
      next.set(tx.key, { ...base, category_id: guess, source: 'rule' });
    }
  }

  return next;
}

/** Shallow equality on annotation maps — keys count + category_id + source per
 *  key.  Anything stronger (note/tags/extras) doesn't affect the auto-tag
 *  decision so we don't need to compare it. */
function annotationsEqual(
  a: Record<string, TransactionAnnotation>,
  b: Record<string, TransactionAnnotation>
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const k of aKeys) {
    const x = a[k];
    const y = b[k];
    if (x?.category_id !== y?.category_id || x?.source !== y?.source) return false;
  }
  return true;
}

/**
 * Convenience: build the categorizable list from imports, train the classifier
 * from the user's existing annotations, run the three-tier `autoCategorize`,
 * and return a fresh CategorizationState — or `null` when nothing actually
 * changed (so the caller can skip a needless persist).  Used on page mount.
 */
export function runAutoCategorize(
  imports: ImportRecord[],
  state: CategorizationState
): CategorizationState | null {
  const txns: CategorizableTransaction[] = [];
  for (const imp of imports) {
    imp.transactions.forEach((t, i) => {
      txns.push({
        key: transactionCategoryKey(imp.pdf_source_hash, i),
        description: t.description
      });
    });
  }
  const cls = trainFromAnnotations(imports, state.annotations);
  const nextMap = autoCategorize(
    txns,
    state.categories,
    state.rules,
    new Map(Object.entries(state.annotations)),
    cls
  );
  const nextAnnotations: Record<string, TransactionAnnotation> = Object.fromEntries(nextMap);
  if (annotationsEqual(state.annotations, nextAnnotations)) return null;
  return { ...state, annotations: nextAnnotations };
}
