/**
 * Level 2 final-answer rules.
 *
 * Pure functions with no server imports, deliberately, so the SAME rule runs in
 * the browser (to tell a participant their proof is short while they are still
 * writing it) and on the server (to decide whether the submission is accepted).
 * Two implementations of "at least 50 words" would eventually disagree, and the
 * disagreement would surface as a form that says "ready" and a server that says
 * "too short".
 *
 * The browser copy is a courtesy. The server copy is the rule.
 */

/** Minimum words in the proof. Stated in the participant brief as "50 or more". */
export const MIN_PROOF_WORDS = 50;

/** Upper bound on the attacker field. A name, not an essay. */
export const MAX_ATTACKER_LENGTH = 200;

/**
 * Upper bound on the proof. Generous — a thorough forensic narrative with
 * pasted log lines is expected — but bounded, because an unbounded text column
 * written by an authenticated client is a denial-of-service surface.
 */
export const MAX_PROOF_LENGTH = 20_000;

/**
 * Counts words the way a person reading the form would.
 *
 * A "word" is a whitespace-delimited token containing at least one letter or
 * digit. That keeps forensic content counting correctly — `192.168.10.24`,
 * `2026-09-05T11:42:03Z` and `powershell.exe` are each one word, which is what a
 * participant writing them expects — while stray punctuation ("-", "•", "→")
 * used as bullets does not inflate the count toward the threshold.
 */
export function countWords(text: string): number {
  if (!text) return 0;
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export interface Level2AnswerInput {
  attacker: string;
  proof: string;
}

export interface Level2AnswerValidation {
  ok: boolean;
  /** Field-keyed messages, ready to render next to the input that produced them. */
  fieldErrors: Partial<Record<'attacker' | 'proof', string>>;
  /** Trimmed, length-capped values. Only meaningful when `ok` is true. */
  normalized: Level2AnswerInput;
  proofWordCount: number;
}

/**
 * Validates and normalises the Level 2 final answer.
 *
 * Returns every failing field at once rather than the first one. A participant
 * who left the attacker blank AND wrote thirty words should be told both things
 * in one pass, not sent round the loop twice at a deadline.
 */
export function validateLevel2Answers(input: Partial<Level2AnswerInput>): Level2AnswerValidation {
  const attacker = (input.attacker ?? '').trim();
  const proof = (input.proof ?? '').trim();
  const proofWordCount = countWords(proof);

  const fieldErrors: Partial<Record<'attacker' | 'proof', string>> = {};

  if (!attacker) {
    fieldErrors.attacker = 'Please identify the attacker or enter Unknown.';
  } else if (attacker.length > MAX_ATTACKER_LENGTH) {
    fieldErrors.attacker = `The attacker field is limited to ${MAX_ATTACKER_LENGTH} characters. Name the attacker here and put the reasoning in the proof.`;
  }

  if (proofWordCount < MIN_PROOF_WORDS) {
    fieldErrors.proof = `Proof must contain at least ${MIN_PROOF_WORDS} words. You have written ${proofWordCount}.`;
  } else if (proof.length > MAX_PROOF_LENGTH) {
    fieldErrors.proof = `Your proof is longer than the ${MAX_PROOF_LENGTH.toLocaleString()} character limit. Attach the full detail as a deliverable and summarise the evidence chain here.`;
  }

  return {
    ok: Object.keys(fieldErrors).length === 0,
    fieldErrors,
    normalized: { attacker, proof },
    proofWordCount,
  };
}

/**
 * Does this level require the structured attacker/proof answer?
 *
 * Only Level 2 does. Level 3 submits a report file through the same pipeline and
 * carries its own separate discovery/answer flow, so demanding an attacker name
 * there would reject valid Level 3 reports.
 */
export function levelRequiresStructuredAnswer(level: number): boolean {
  return level === 2;
}
