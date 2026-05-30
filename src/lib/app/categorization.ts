/**
 * Categorization engine (US-P2-A) — pure logic, no storage/UI dependency.
 *
 * The user assigns categories to transactions two ways:
 *   1. Manually (a label they pick) — this ALWAYS wins and is never overwritten.
 *   2. By rule ("if the description contains AMAZON → Shopping") — re-applyable to
 *      past transactions; rule-assigned labels are recomputed when rules change.
 *
 * Constitution / project rule (see memory `feedback_no_amount_based_classification`):
 * rules match on the transaction DESCRIPTION (text/structure) only — NEVER on the
 * amount. We do not guess meaning from how big a number is; the user labels the rest.
 *
 * Annotations are keyed by a STABLE content key (`<pdf_source_hash>#<txIndex>`), not
 * by array position, so a category survives the sync merge (which re-orders the
 * imports array). An import is immutable by its hash, so its transaction order is fixed.
 */

export interface Category {
  id: string;
  name: string;
  /** Optional UI color (hex or CSS var); not used by the matching logic. */
  color?: string;
  /** Optional icon override (IconKey from category-visuals.ts).  When absent
   *  the icon is auto-mapped by name.  Set by the user via the rename sheet
   *  in CategoryPicker.  Free-form string so a future emoji-mode doesn't
   *  require a schema migration. */
  icon?: string;
  /** Optional parent category id — set when this category is a SUB of
   *  another (e.g. "Biryani" under "Food", "Ice cream" under "Food").
   *  One level deep only; the picker doesn't render grand-children even
   *  if the data has them.  Reports treat a sub's spend as both its own
   *  bucket AND a contribution to the parent. */
  parent_id?: string;
}

export interface CategoryRule {
  id: string;
  /** Substring to look for in the description (used when `regex` is absent). */
  contains?: string;
  /** Alternative to `contains`: a regular-expression source string. */
  regex?: string;
  /** Default false → case-insensitive matching. */
  case_sensitive?: boolean;
  /** The category this rule assigns when it matches. */
  category_id: string;
  /** Disabled rules are skipped by `applyRules`. Default (undefined) = enabled. */
  enabled?: boolean;
}

export interface TransactionAnnotation {
  /** Assigned category, or null for explicitly "uncategorized". */
  category_id: string | null;
  /** How the CATEGORY was set: 'manual' (sticky) or 'rule'. */
  source: 'manual' | 'rule';
  /** The rule that produced a 'rule'-sourced category (for re-apply/audit). */
  rule_id?: string;
  // ── User extras (Rocket-Money-style transaction actions) ──
  // These are independent of the category and are PRESERVED across rule re-apply.
  /** Free-text note. */
  note?: string;
  /** Free-form labels (orthogonal to the single category). */
  tags?: string[];
  /** Exclude from spending/budget aggregations (still shown, greyed). */
  ignored?: boolean;
  /** Display name override (rename). */
  custom_name?: string;
  /** User-marked recurring (overrides/augments auto-detection). */
  is_recurring?: boolean;
  /**
   * This transaction is a REFUND of another (US-P3-C). Value is the stable key
   * (`<pdf_source_hash>#<txIndex>`) of the original purchase. When set, spending
   * aggregation treats this (positive) refund as belonging to the ORIGINAL's
   * category, so it nets against that category instead of being double-counted as
   * income. See `resolveEffectiveCategory` in categorization-glue.ts.
   */
  refund_of?: string;
  /**
   * Split this transaction across multiple categories (US-SPLIT). Each part has a
   * SIGNED amount (matching the transaction's sign) and a category; the parts need
   * not sum to the whole — spending aggregation emits each part plus a remainder so
   * the total is always conserved (see `summaryFromImports`). An empty/absent split
   * means the transaction is NOT split.
   */
  split?: TransactionSplit[];
  /**
   * Optional manual override of the inferred flow_intent (REQ-B0.1).  Set this
   * via the row-edit drawer when the user wants to flip e.g. an "unknown" into
   * a "transfer_self" so it stops counting toward Spent.  Wins over the
   * built-in pattern map and the auto-detectors.  Format: one of the
   * `FlowIntent` literals from `src/lib/app/flow-intent.ts`.
   */
  flow_intent?: string;
}

/** One leg of a split transaction (US-SPLIT). */
export interface TransactionSplit {
  category_id: string | null;
  /** Signed cents (same sign as the parent transaction). */
  amount_minor: bigint;
  /**
   * Optional per-part flow_intent override (one of the FlowIntent literals,
   * kept as a string to avoid a module cycle). Lets ONE deposit be split across
   * buckets — e.g. cap a $5000 paycheck to $4000 income and route the $1000
   * leftover to savings (`investment_out`) or set-aside (`transfer_self`).
   * Absent → the part inherits the parent transaction's intent. Affects ONLY
   * which bucket the part lands in (spend / income / movement) in
   * summaryByFlowIntent — never the amount, so summaryFromImports conservation
   * is untouched.
   */
  flow_intent?: string;
}

/** The user-extra fields, as present on an annotation (omitting empty ones). */
function extrasOf(a: TransactionAnnotation): Partial<TransactionAnnotation> {
  const e: Partial<TransactionAnnotation> = {};
  if (a.note !== undefined) e.note = a.note;
  if (a.tags !== undefined && a.tags.length > 0) e.tags = a.tags;
  if (a.ignored) e.ignored = true;
  if (a.custom_name !== undefined) e.custom_name = a.custom_name;
  if (a.is_recurring) e.is_recurring = true;
  if (a.refund_of !== undefined) e.refund_of = a.refund_of;
  if (a.split !== undefined && a.split.length > 0) e.split = a.split;
  // A manual flow_intent override (e.g. "this deposit is NOT income") is a user
  // extra and MUST survive a rule re-apply — applyRules runs on every load, and
  // an override on a transaction with no category/other-extras was being dropped
  // (the deposit reverted to income). Same class of bug as pruneAnnotation.
  if (a.flow_intent !== undefined && a.flow_intent !== '') e.flow_intent = a.flow_intent;
  return e;
}
function hasExtras(a: TransactionAnnotation): boolean {
  return Object.keys(extrasOf(a)).length > 0;
}
/** A category the user pinned by hand (so rules must not overwrite it). */
function isManualCategory(a: TransactionAnnotation): boolean {
  return a.source === 'manual' && a.category_id !== null;
}

/** A transaction reduced to what the engine needs: a stable key + its description. */
export interface CategorizableTransaction {
  key: string;
  description: string;
}

/** Stable annotation key for a transaction: the import's content hash + its index. */
export function transactionCategoryKey(pdfSourceHash: string, txIndex: number): string {
  return `${pdfSourceHash}#${txIndex}`;
}

/** Pure: does this rule match the given description? Description-only, never amount. */
export function matchRule(rule: CategoryRule, description: string): boolean {
  if (rule.regex !== undefined && rule.regex !== '') {
    const flags = rule.case_sensitive === true ? '' : 'i';
    try {
      return new RegExp(rule.regex, flags).test(description);
    } catch {
      // An invalid regex never matches (the rule UI validates; this is defense-in-depth).
      return false;
    }
  }
  if (rule.contains !== undefined && rule.contains !== '') {
    if (rule.case_sensitive === true) return description.includes(rule.contains);
    return description.toLowerCase().includes(rule.contains.toLowerCase());
  }
  // A rule with neither a non-empty `contains` nor `regex` matches nothing
  // (an empty pattern must not silently tag every transaction).
  return false;
}

/** The first enabled rule (in list order) whose matcher hits, or null. */
export function firstMatchingRule(rules: CategoryRule[], description: string): CategoryRule | null {
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (matchRule(rule, description)) return rule;
  }
  return null;
}

/**
 * Apply rules to a set of transactions, producing the next annotation map.
 *
 * - A 'manual' annotation is preserved verbatim (manual override sticks).
 * - Otherwise the first matching enabled rule assigns a 'rule'-sourced annotation.
 * - A transaction that previously had a 'rule' annotation but now matches no rule
 *   loses it (rule-sourced labels are recomputed, not sticky).
 *
 * Pure: returns a NEW map; the input map is not mutated. Idempotent for a fixed
 * rule set (applying twice yields the same result).
 */
export function applyRules(
  rules: CategoryRule[],
  transactions: CategorizableTransaction[],
  existing: ReadonlyMap<string, TransactionAnnotation>
): Map<string, TransactionAnnotation> {
  const next = new Map<string, TransactionAnnotation>();

  // Carry over annotations to preserve: a manually-pinned category, AND any
  // user extras (note/tags/ignored/rename/recurring), even for txns not in this batch.
  for (const [key, ann] of existing) {
    if (isManualCategory(ann) || hasExtras(ann)) next.set(key, ann);
  }

  for (const tx of transactions) {
    const prior = existing.get(tx.key);
    if (prior !== undefined && isManualCategory(prior)) continue; // manual category wins
    const extras = prior !== undefined ? extrasOf(prior) : {};
    const rule = firstMatchingRule(rules, tx.description);
    if (rule !== null) {
      next.set(tx.key, {
        category_id: rule.category_id,
        source: 'rule',
        rule_id: rule.id,
        ...extras
      });
    } else if (Object.keys(extras).length > 0) {
      // No rule matches, but the user's extras must survive (category cleared).
      next.set(tx.key, { category_id: null, source: 'manual', ...extras });
    } else {
      next.delete(tx.key); // no category, no extras → nothing to keep
    }
  }

  return next;
}

/** Set (or clear) a manual category for one transaction, preserving any extras. */
export function setManualCategory(
  annotations: ReadonlyMap<string, TransactionAnnotation>,
  key: string,
  categoryId: string | null
): Map<string, TransactionAnnotation> {
  const next = new Map(annotations);
  const prior = annotations.get(key);
  next.set(key, {
    ...(prior !== undefined ? extrasOf(prior) : {}),
    category_id: categoryId,
    source: 'manual'
  });
  return next;
}

/**
 * Merge a partial patch (note/tags/ignored/custom_name/is_recurring, or category)
 * into a transaction's annotation, creating one if absent. Returns a new map.
 */
export function setAnnotation(
  annotations: ReadonlyMap<string, TransactionAnnotation>,
  key: string,
  patch: Partial<TransactionAnnotation>
): Map<string, TransactionAnnotation> {
  const next = new Map(annotations);
  const prior: TransactionAnnotation = annotations.get(key) ?? {
    category_id: null,
    source: 'manual'
  };
  next.set(key, { ...prior, ...patch });
  return next;
}

/**
 * Normalize an annotation after a user edit: drop empty/cleared extras so they
 * don't override the parsed values or linger as noise (an empty rename must fall
 * back to the description; an empty note/tag set must vanish). Returns null when
 * the annotation carries nothing meaningful (uncategorized, manual, no extras) —
 * the caller should delete the entry entirely in that case. Pure.
 */
export function pruneAnnotation(a: TransactionAnnotation): TransactionAnnotation | null {
  const cleaned: TransactionAnnotation = { category_id: a.category_id, source: a.source };
  if (a.rule_id !== undefined) cleaned.rule_id = a.rule_id;
  if (a.note !== undefined && a.note !== '') cleaned.note = a.note;
  if (a.tags !== undefined && a.tags.length > 0) cleaned.tags = a.tags;
  if (a.ignored === true) cleaned.ignored = true;
  if (a.custom_name !== undefined && a.custom_name !== '') cleaned.custom_name = a.custom_name;
  if (a.is_recurring === true) cleaned.is_recurring = true;
  if (a.refund_of !== undefined && a.refund_of !== '') cleaned.refund_of = a.refund_of;
  if (a.split !== undefined && a.split.length > 0) cleaned.split = a.split;
  // A manual flow_intent override (e.g. "this deposit is NOT income → transfer_self"
  // from the Manage-income sheet, or an intent flip from the row drawer) must
  // survive normalization. This was previously dropped, silently undoing the edit.
  if (a.flow_intent !== undefined && a.flow_intent !== '') cleaned.flow_intent = a.flow_intent;
  // An uncategorized, manual annotation with no extras carries nothing — drop it.
  if (
    cleaned.category_id === null &&
    cleaned.source === 'manual' &&
    Object.keys(cleaned).length === 2
  ) {
    return null;
  }
  return cleaned;
}

/**
 * Rename a category and/or set its icon override.  Returns the new
 * categories list (other entries are unchanged).  Pure.
 *
 * - When `newName` is provided + non-empty, the name is updated.
 * - When `newIcon` is provided (including empty string to clear the
 *   override), the icon is updated.  Pass `undefined` to leave alone.
 *
 * Annotations and rules are NOT touched — they reference the category
 * by id, which is stable across a rename.
 */
export function renameCategory(
  categories: Category[],
  id: string,
  newName?: string,
  newIcon?: string
): Category[] {
  return categories.map((c) => {
    if (c.id !== id) return c;
    const next: Category = { ...c };
    if (newName !== undefined && newName.trim().length > 0) {
      next.name = newName.trim();
    }
    if (newIcon !== undefined) {
      if (newIcon === '') delete next.icon;
      else next.icon = newIcon;
    }
    return next;
  });
}

/**
 * Remove a category: drop it from the list and clear every annotation that
 * pointed at it (manual ones become an explicit null; rule ones are dropped so a
 * later re-apply can reassign). Returns the new categories + annotations.
 */
export function deleteCategory(
  categories: Category[],
  annotations: ReadonlyMap<string, TransactionAnnotation>,
  categoryId: string
): { categories: Category[]; annotations: Map<string, TransactionAnnotation> } {
  const nextCategories = categories.filter((c) => c.id !== categoryId);
  const nextAnnotations = new Map<string, TransactionAnnotation>();
  for (const [key, ann] of annotations) {
    if (ann.category_id !== categoryId) {
      nextAnnotations.set(key, ann);
    } else if (ann.source === 'manual' || hasExtras(ann)) {
      // Clear the (now-deleted) category but keep the user's extras.
      nextAnnotations.set(key, { ...extrasOf(ann), category_id: null, source: 'manual' });
    }
    // rule-sourced annotation with no extras pointing at the deleted category → dropped.
  }
  return { categories: nextCategories, annotations: nextAnnotations };
}
