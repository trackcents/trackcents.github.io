# Verification Contract — categorization (US-P2-A rule engine + annotation overlay)

> Implementation-free contract for the independent verifier. WHAT + interface, never HOW.
> Produced by the Designer; consumed by the `verification-engineer` (via `/ivv`).

## 1. Module under verification

- **Source file** (do NOT open): `src/lib/app/categorization.ts`
- **Public entry points**: `matchRule`, `firstMatchingRule`, `applyRules`, `setManualCategory`,
  `setAnnotation`, `pruneAnnotation`, `deleteCategory`, `transactionCategoryKey`.
- **Risk tier**: **Core (money-adjacent).** Categorization drives the spending-by-category
  dashboards, so a mis-categorization or a clobbered user choice corrupts the user's money
  picture. NOT bigint money math itself, but its OUTPUT decides which bucket spending lands in.
- **Touches**: ☑ user-intent preservation (the headline) ☑ rule/pattern matching ☐ bigint math ☐ parsing ☐ authz ☐ UI
- **Right-sizing note:** **LEAN — Stage 1 only** unless a bug is found. The high-yield checks are
  the user-intent SAFETY properties (manual category sticks; user extras survive) as metamorphic/
  property tests, plus matchRule boundary cases and firstMatchingRule precedence. No mutation marathon.
- **Already verified separately (do NOT re-verify):** `resolveEffectiveCategory` + `summaryFromImports`
  (refund netting + split distribution) live in `categorization-glue.ts` and are signed off. This run
  covers the RULE ENGINE + the annotation CRUD in `categorization.ts`.

## 2. Authoritative spec sources

- `specs/001-money-tracker-mvp/spec.md` — **US-P2-A** ("assign categories; define rules like 'if
  description contains AMAZON, category = Shopping' and re-apply to past transactions; **manual
  override sticks**; edit/add/delete categories") + the project rule (memory): **never classify by
  amount — description/structure only**.
- `specs/001-money-tracker-mvp/data-model.md` — annotation/category model.

## 3. Public interface (signatures only)

```ts
interface Category { id: string; name: string; color?: string; }
interface CategoryRule {
  id: string; contains?: string; regex?: string; case_sensitive?: boolean;
  category_id: string; enabled?: boolean;
}
interface TransactionAnnotation {
  category_id: string | null; source: 'manual' | 'rule'; rule_id?: string;
  note?: string; tags?: string[]; ignored?: boolean; custom_name?: string;
  is_recurring?: boolean; refund_of?: string; split?: TransactionSplit[];
}
interface CategorizableTransaction { key: string; description: string; }

export function transactionCategoryKey(pdfSourceHash: string, txIndex: number): string;
export function matchRule(rule: CategoryRule, description: string): boolean;
export function firstMatchingRule(rules: CategoryRule[], description: string): CategoryRule | null;
export function applyRules(rules: CategoryRule[], transactions: CategorizableTransaction[],
  existing: ReadonlyMap<string, TransactionAnnotation>): Map<string, TransactionAnnotation>;
export function setManualCategory(annotations: ReadonlyMap<string, TransactionAnnotation>,
  key: string, categoryId: string | null): Map<string, TransactionAnnotation>;
export function setAnnotation(annotations: ReadonlyMap<string, TransactionAnnotation>,
  key: string, patch: Partial<TransactionAnnotation>): Map<string, TransactionAnnotation>;
export function pruneAnnotation(a: TransactionAnnotation): TransactionAnnotation | null;
export function deleteCategory(categories: Category[],
  annotations: ReadonlyMap<string, TransactionAnnotation>, categoryId: string):
  { categories: Category[]; annotations: Map<string, TransactionAnnotation> };
```

The "user extras" set = `{ note, tags, ignored, custom_name, is_recurring, refund_of, split }`
(everything EXCEPT `category_id`/`source`/`rule_id`). "Empty" extras = `note:''`, `tags:[]`,
`ignored:false/absent`, `custom_name:''`, `refund_of:''`, `split:[]`.

## 4. Behavioral requirements (the WHAT)

- **R1 — `matchRule`:** description-only (NEVER amount). If `regex` is present & non-empty → match
  by regex (case-insensitive unless `case_sensitive===true`); an INVALID regex matches NOTHING
  (returns false, never throws). Else if `contains` is present & non-empty → substring match
  (case-insensitive unless `case_sensitive`). A rule with neither non-empty `contains` nor `regex`
  matches NOTHING (an empty pattern must not tag every transaction). `regex` takes precedence over
  `contains` when both present.
- **R2 — `firstMatchingRule`:** returns the FIRST rule in list order that is enabled
  (`enabled !== false`) AND matches; `null` if none. Disabled rules (`enabled===false`) are skipped.
- **R3 — `applyRules` assigns rule categories:** for each transaction with no manual category, the
  first matching enabled rule assigns a `{category_id, source:'rule', rule_id}` annotation.
- **R4 — `applyRules` manual override STICKS (headline safety):** a transaction whose existing
  annotation is a manual category (`source:'manual'` AND `category_id !== null`) is PRESERVED
  verbatim — a rule NEVER overwrites it.
- **R5 — `applyRules` rule labels are RECOMPUTED, not sticky:** a transaction that previously had a
  rule-sourced category but now matches no rule LOSES that category (it is not retained).
- **R6 — `applyRules` preserves user extras across re-apply:** note/tags/ignored/custom_name/
  is_recurring/refund_of/split on an existing annotation SURVIVE, whether the txn now gets a rule
  category, keeps a manual one, or matches nothing (in the no-match-with-extras case the category is
  cleared to null/manual but the extras remain). Extras on txns NOT in the current batch are also
  carried over.
- **R7 — `applyRules` drops empties:** a txn with no manual category, no matching rule, and no extras
  has NO entry in the output map (no orphan empty annotation).
- **R8 — `setManualCategory`:** sets `{category_id, source:'manual'}` for the key, preserving any
  prior extras; returns a new map (input not mutated).
- **R9 — `setAnnotation`:** merges a partial patch onto the prior annotation (or a default
  uncategorized-manual one if absent); returns a new map.
- **R10 — `pruneAnnotation`:** drops empty extras (empty note/custom_name/refund_of, empty tags/split,
  false ignored/is_recurring); returns `null` iff the result is an uncategorized manual annotation
  with no extras (caller deletes it).
- **R11 — `deleteCategory`:** removes the category from the list; for each annotation pointing at it:
  a manual one (or any with extras) keeps its extras with `category_id:null, source:'manual'`; a
  rule-sourced one with no extras is dropped; annotations pointing elsewhere are untouched.

## 5. Invariants & properties (hold for ALL valid inputs)

- **INV1 — Manual category is immortal under `applyRules` (headline).** For any rules + any
  transactions, if `existing[k]` is a manual category, `applyRules(...)[k]` deep-equals it. No rule,
  in any configuration, changes a manually-categorized transaction's category.
- **INV2 — Extras are preserved by `applyRules`.** For any key with extras in `existing`, the output
  annotation for that key (if present) carries the SAME extras (note/tags/ignored/custom_name/
  is_recurring/refund_of/split). Re-applying rules never erases a user's note/tags/ignored flag.
- **INV3 — Idempotence.** `applyRules(rules, txns, applyRules(rules, txns, existing))` deep-equals
  `applyRules(rules, txns, existing)`.
- **INV4 — Purity.** `applyRules`, `setManualCategory`, `setAnnotation`, `deleteCategory` return NEW
  maps and never mutate their input map/annotations; `matchRule`/`firstMatchingRule`/`pruneAnnotation`
  are side-effect-free.
- **INV5 — No amount-based classification.** `matchRule` depends ONLY on the description string; it
  has no access to and no dependence on any amount. (Structural check: the signature takes only a
  rule + a description.)
- **INV6 — `firstMatchingRule` ⊑ `matchRule`:** the returned rule (if any) is enabled and
  `matchRule(rule, desc)` is true; if it returns null, no enabled rule matches.
- **INV7 — `deleteCategory` removes all dangling references:** no annotation in the output points at
  the deleted `categoryId`; categories no longer contain it; unrelated annotations/categories are
  unchanged.

## 6. Domain edge cases that MUST be handled

- `matchRule`: empty `contains`/`regex` → false; invalid regex (`"[“`) → false (no throw); case
  sensitivity both ways; regex AND contains both present (regex wins); Unicode/special chars in
  description.
- `firstMatchingRule`: two rules match (first wins); the first match is disabled (skipped → second
  wins); all disabled (null); empty rules list (null).
- `applyRules`: a manual category + a matching rule (manual wins, INV1); a rule-categorized txn that
  now matches nothing (category lost, R5); a txn with extras + no rule (extras kept, category
  cleared); a txn with neither (dropped, R7); extras on a key NOT in the batch (carried over); empty
  rules / empty transactions.
- `deleteCategory`: deleting a category referenced by manual (→null, keep extras), by rule-only
  (dropped), by rule+extras (kept with extras, null category), and not referenced at all.
- `pruneAnnotation`: all-empty manual-uncategorized → null; a lone `ignored:true` → kept.

## 7. Explicitly OUT of scope / deferred — do NOT report as bugs

- `resolveEffectiveCategory` / `summaryFromImports` (refund netting + split distribution) — in
  `categorization-glue.ts`, separately signed off.
- The Svelte categorization UI / review flow (E2E elsewhere).
- Persistence/encryption of the categorization store (separate concern).
- A full mutation marathon (§1 right-sizing) unless Stage 1 finds a bug.

## 8. Error contract (no silent failures)

All functions are TOTAL on well-shaped input and MUST NOT throw — notably `matchRule` on an INVALID
regex returns false (defense-in-depth), never throwing. "No silent failure" here = the engine must
never silently DISCARD a user's manual category or extras (INV1/INV2), and an empty rule pattern must
never silently tag every transaction (R1).

## 9–10. Security / runtime
N/A — pure logic; UI covered by E2E.

## 11. Known oracle hazards

- **INV1/INV2 (manual-sticks, extras-survive) are the oracle-free headline metamorphic checks** —
  generate random rules + random existing annotations (mix of manual/rule/extras), apply rules, and
  assert every manual category and every extras-bag survives. A re-implementation of `applyRules`
  would share blind spots; prefer these property/metamorphic checks + hand-built scenarios over a
  mirror model.
- **Empty-pattern tag-everything (R1):** a classic bug is treating an empty `contains` as "matches
  all." Probe `{contains:''}` and `{}` → must match NOTHING.
- **Disabled-rule skipping (R2):** ensure `enabled===false` is skipped but `enabled===undefined`
  (default) is ENABLED — an easy inversion bug.
- **Extras vs category independence:** clearing/changing a category must not touch extras and vice
  versa; the `refund_of`/`split` extras (money-relevant) must survive exactly.
