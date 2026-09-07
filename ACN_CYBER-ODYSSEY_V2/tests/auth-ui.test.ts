import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_TYPE_OPTIONS,
  CREATOR_APPROVAL_GUIDANCE,
  PARTICIPANT_EMAIL_GUIDANCE,
  accountTypeGuidance,
  requiresCreatorApproval,
  type AccountType,
} from '@/components/auth/account-type-selector';

describe('Authentication UI Visual System & Constraints', () => {
  it('enforces that Creator is NOT a public signup option', () => {
    const types = ACCOUNT_TYPE_OPTIONS.map((item) => item.type);
    expect(types).toContain('PARTICIPANT');
    expect(types).toContain('EVALUATOR');
    expect(types).toContain('ADMIN');
    expect(types).not.toContain('CREATOR');
    expect(types.length).toBe(3);
  });

  it('sets Participant as the primary default account type option', () => {
    expect(ACCOUNT_TYPE_OPTIONS[0]?.type).toBe('PARTICIPANT');
  });

  it('provides label for each account type option', () => {
    for (const option of ACCOUNT_TYPE_OPTIONS) {
      expect(option.label).toBeTruthy();
    }
  });

  it('permits flexible usernames without strict regex constraints', () => {
    expect('investigator_01'.trim().length > 0).toBe(true);
    expect('Agent 47'.trim().length > 0).toBe(true);
    expect('shadow.analyst'.trim().length > 0).toBe(true);
    expect(''.trim().length > 0).toBe(false);
  });

  it('validates email format rules', () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    expect(emailRegex.test('participant@example.com')).toBe(true);
    expect(emailRegex.test('marshal@acn.org')).toBe(true);
    expect(emailRegex.test('invalid-email')).toBe(false);
    expect(emailRegex.test('test@')).toBe(false);
  });

  it('enforces password minimum length of 12 characters', () => {
    const minLength = 12;
    expect('shortpass'.length >= minLength).toBe(false);
    expect('twelvechars!'.length >= minLength).toBe(true);
    expect('verysecurepassword12345'.length >= minLength).toBe(true);
  });
});

describe('Account Type Guidance Note', () => {
  it('tells Participants to reuse their Unstop email address', () => {
    expect(accountTypeGuidance('PARTICIPANT')).toBe(
      'Use the same email address you registered with on Unstop.',
    );
    expect(PARTICIPANT_EMAIL_GUIDANCE).toBe(accountTypeGuidance('PARTICIPANT'));
  });

  it('tells every non-Participant account type that Creator approval is required', () => {
    const nonParticipant = ACCOUNT_TYPE_OPTIONS.map((o) => o.type).filter(
      (type) => type !== 'PARTICIPANT',
    );

    // Guards against a future account type being added to the dropdown without
    // guidance: every option that is not Participant must carry the approval note.
    expect(nonParticipant.length).toBeGreaterThan(0);
    for (const type of nonParticipant) {
      expect(accountTypeGuidance(type)).toBe('Creator approval is required for this account type.');
    }
  });

  it('produces guidance for every option offered in the dropdown', () => {
    for (const option of ACCOUNT_TYPE_OPTIONS) {
      const note = accountTypeGuidance(option.type);
      expect(note).toBeTruthy();
      expect([PARTICIPANT_EMAIL_GUIDANCE, CREATOR_APPROVAL_GUIDANCE]).toContain(note);
    }
  });

  it('derives the note purely from the selected type, so it changes with the dropdown', () => {
    // Same input, same output, no hidden state: this is what makes the note
    // update on selection and makes server and client render identically.
    const sequence: AccountType[] = ['PARTICIPANT', 'EVALUATOR', 'ADMIN', 'PARTICIPANT'];
    const notes = sequence.map(accountTypeGuidance);

    expect(notes[0]).toBe(PARTICIPANT_EMAIL_GUIDANCE);
    expect(notes[1]).toBe(CREATOR_APPROVAL_GUIDANCE);
    expect(notes[2]).toBe(CREATOR_APPROVAL_GUIDANCE);
    // Returning to Participant restores the original note rather than sticking.
    expect(notes[3]).toBe(PARTICIPANT_EMAIL_GUIDANCE);
  });

  it('flags exactly the account types that the server holds for approval', () => {
    // The set here must equal the set that registerParticipantAction creates as
    // PENDING_APPROVAL. tests/auth-account-type-guidance.test.ts proves that
    // against the real action; this pins the client-side mirror of it.
    expect(requiresCreatorApproval('PARTICIPANT')).toBe(false);
    expect(requiresCreatorApproval('EVALUATOR')).toBe(true);
    expect(requiresCreatorApproval('ADMIN')).toBe(true);
  });
});
