/**
 * Passphrase-strength estimate for the onboarding meter (FR-003).
 *
 * Dependency-free on purpose (a full zxcvbn-ts pull-in — ~heavy — is deferred).
 * Scores 0–4 from length + character-class variety, with a penalty for obviously
 * weak/common inputs. A LONG passphrase of plain words is intentionally allowed to
 * score well (passphrase philosophy). Documented MINIMUM to proceed: length ≥ 12
 * AND score ≥ 3.
 */
export type StrengthScore = 0 | 1 | 2 | 3 | 4;

export interface PassphraseStrength {
  score: StrengthScore;
  label: string;
  meetsMinimum: boolean;
  suggestions: string[];
}

export const MIN_LENGTH = 12;
const MIN_SCORE = 3;
const LABELS = ['very weak', 'weak', 'fair', 'good', 'strong'] as const;
const COMMON = new Set([
  'password',
  'password1',
  '12345678',
  '123456789',
  'qwerty',
  'qwertyuiop',
  'letmein',
  'iloveyou',
  'admin',
  'welcome'
]);

export function estimatePassphraseStrength(passphrase: string): PassphraseStrength {
  if (passphrase.length === 0) {
    return {
      score: 0,
      label: LABELS[0],
      meetsMinimum: false,
      suggestions: ['Enter a passphrase.']
    };
  }

  let points = 0;
  if (passphrase.length >= 12) points += 2;
  else if (passphrase.length >= 8) points += 1;
  if (passphrase.length >= 16) points += 1;

  let classes = 0;
  if (/[a-z]/.test(passphrase)) classes++;
  if (/[A-Z]/.test(passphrase)) classes++;
  if (/[0-9]/.test(passphrase)) classes++;
  if (/[^A-Za-z0-9]/.test(passphrase)) classes++;
  if (classes >= 3) points += 1;
  if (classes >= 4) points += 1;

  // Penalties for trivially-guessable inputs.
  if (COMMON.has(passphrase.toLowerCase())) points = 0;
  if (/^(.)\1+$/.test(passphrase)) points = Math.min(points, 1); // a single repeated char

  const suggestions: string[] = [];
  if (passphrase.length < MIN_LENGTH) suggestions.push(`Use at least ${MIN_LENGTH} characters.`);
  if (classes < 3) {
    suggestions.push(
      'Add variety (cases, numbers, symbols) — or use a longer passphrase of several words.'
    );
  }

  const score = Math.max(0, Math.min(4, points)) as StrengthScore;
  const meetsMinimum = passphrase.length >= MIN_LENGTH && score >= MIN_SCORE;
  return { score, label: LABELS[score], meetsMinimum, suggestions };
}
