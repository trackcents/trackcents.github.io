/**
 * Self-learning category classifier — the on-device "smart category" layer.
 *
 * This is the privacy-safe alternative to a 25-MB Transformers.js model that
 * Hemanth originally asked about.  `wink-naive-bayes-text-classifier` is ~few
 * KB, runs entirely in the browser, never downloads a model, and learns from
 * the user's OWN annotation history every session.  Privacy by construction.
 *
 * Three-tier categorization (composed in `auto-categorize.ts`):
 *   1. User rules (strongest)        — `firstMatchingRule`
 *   2. Built-in keyword map          — `guessCategoryId`
 *   3. Naive-Bayes prediction (this) — learned from descriptions ↔ categories
 *
 * The classifier is trained in-memory on each load (training is cheap — a few
 * KB of text across a few hundred transactions); we deliberately don't persist
 * the trained state because (a) it would bloat the synced encrypted blob, and
 * (b) re-training is O(N) over annotations which is plenty fast for our scale.
 */
import winkBayes from 'wink-naive-bayes-text-classifier';
import type { ImportRecord } from '../db/store';
import type { TransactionAnnotation } from './categorization';

// Tokenize: lowercase, strip non-letter/digit, drop ≤1-char tokens.  Unicode-
// aware so chai / café / biryani / नमस्ते all tokenize cleanly.
const PUNCT_RE = /[^\p{L}\p{N}\s]/gu;
function prep(s: string): string[] {
  return s
    .toLowerCase()
    .replace(PUNCT_RE, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

export interface ClassifierState {
  /** The wink classifier instance — has its own internal training state. */
  classifier: ReturnType<typeof winkBayes>;
  /** True only when enough distinct labels were seen to actually predict. */
  ready: boolean;
  /** How many description ↔ category samples were learned (for diagnostics). */
  samples: number;
}

/**
 * Train (or re-train) the classifier on every description ↔ category pair the
 * user has so far.  Manual + rule-tagged annotations both count as ground truth.
 * Returns a fresh state — never mutates the input.
 */
export function trainFromAnnotations(
  imports: ImportRecord[],
  annotations: Record<string, TransactionAnnotation>
): ClassifierState {
  const c = winkBayes();
  c.definePrepTasks([prep]);
  // `considerOnlyPresence: true` is Bernoulli NB — better for short merchant
  // descriptions than the default multinomial. Smoothing keeps unseen tokens
  // from collapsing prediction probabilities to zero.
  c.defineConfig({ considerOnlyPresence: true, smoothingFactor: 0.5 });

  const labels = new Set<string>();
  let samples = 0;
  for (const imp of imports) {
    for (let i = 0; i < imp.transactions.length; i++) {
      const ann = annotations[`${imp.pdf_source_hash}#${i}`];
      const cat = ann?.category_id;
      if (cat === null || cat === undefined) continue;
      const desc = imp.transactions[i]?.description;
      if (desc === undefined || desc.trim().length === 0) continue;
      try {
        c.learn(desc, cat);
        labels.add(cat);
        samples++;
      } catch {
        // Silently skip rows the lib refuses (e.g. empty after prep).
      }
    }
  }

  // wink-bayes needs ≥2 distinct labels to compute posterior odds; require a
  // few samples too, otherwise a single accidental tag would dominate.
  const ready = labels.size >= 2 && samples >= 4;
  if (ready) {
    try {
      c.consolidate();
    } catch {
      return { classifier: c, ready: false, samples };
    }
  }
  return { classifier: c, ready, samples };
}

/**
 * Predict a category for a description.  Returns `null` when:
 *   - the classifier wasn't trained on enough data (`!state.ready`), or
 *   - the lib couldn't make a confident prediction (`'unknown'`).
 *
 * Conservative on purpose: false-categorization is more annoying than no
 * category, and the caller falls back to "Uncategorized".
 */
export function predictCategory(state: ClassifierState, description: string): string | null {
  if (!state.ready) return null;
  const text = description.trim();
  if (text.length === 0) return null;
  try {
    const r = state.classifier.predict(text);
    if (typeof r !== 'string' || r === 'unknown') return null;
    return r;
  } catch {
    return null;
  }
}
