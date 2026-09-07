'use client';

import * as React from 'react';
import { Label } from '@/components/ui/field';

export type AccountType = 'PARTICIPANT' | 'EVALUATOR' | 'ADMIN';

export interface AccountTypeOption {
  type: AccountType;
  label: string;
}

/**
 * Account types offered on the public signup form.
 *
 * CREATOR is deliberately absent: `registerParticipantAction` only ever accepts
 * EVALUATOR or ADMIN and falls back to PARTICIPANT for anything else, so the
 * Creator role cannot be self-assigned. Listing it here would advertise a
 * privilege escalation path that does not exist and that the server would
 * silently downgrade.
 */
export const ACCOUNT_TYPE_OPTIONS: AccountTypeOption[] = [
  { type: 'PARTICIPANT', label: 'Participant' },
  { type: 'EVALUATOR', label: 'Evaluator' },
  { type: 'ADMIN', label: 'Admin' },
];

/**
 * Guidance shown directly beneath the Account Type control.
 *
 * Participants register themselves against their Unstop entry, so the only
 * thing they need told is which email address to use. Staff accounts are
 * created PENDING_APPROVAL and stay locked out until a Creator approves them,
 * so the note sets that expectation before the account is created rather than
 * after.
 */
export const PARTICIPANT_EMAIL_GUIDANCE =
  'Use the same email address you registered with on Unstop.';

export const CREATOR_APPROVAL_GUIDANCE = 'Creator approval is required for this account type.';

/**
 * Whether this account type is held for Creator approval after signup.
 *
 * PRESENTATION ONLY. This mirrors the server rule in `registerParticipantAction`
 * (EVALUATOR and ADMIN are created PENDING_APPROVAL, and approval is granted
 * solely by the `assertCreator`-guarded `approveStaffAction`). It decides
 * nothing: flipping it would change the wording on the form and nothing else,
 * because account status is set server-side. `tests/auth-ui.test.ts` pins the
 * two in agreement so the message cannot drift away from the behaviour.
 */
export function requiresCreatorApproval(type: AccountType): boolean {
  return type === 'EVALUATOR' || type === 'ADMIN';
}

/** Note rendered under the selector. Pure, so it re-derives on every change of state. */
export function accountTypeGuidance(type: AccountType): string {
  return requiresCreatorApproval(type) ? CREATOR_APPROVAL_GUIDANCE : PARTICIPANT_EMAIL_GUIDANCE;
}

export const ACCOUNT_TYPE_GUIDANCE_ID = 'account-type-guidance';

interface AccountTypeSelectorProps {
  value?: AccountType;
  onChange: (value: AccountType) => void;
  disabled?: boolean;
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function AccountTypeSelector({
  value = 'PARTICIPANT',
  onChange,
  disabled = false,
}: AccountTypeSelectorProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const currentType = value || 'PARTICIPANT';
  const selectedOption =
    ACCOUNT_TYPE_OPTIONS.find((opt) => opt.type === currentType) || ACCOUNT_TYPE_OPTIONS[0]!;

  // Derived during render, so the note is always in step with the dropdown:
  // no effect, no second paint, and identical output on server and client.
  const needsApproval = requiresCreatorApproval(currentType);
  const guidance = accountTypeGuidance(currentType);

  // Close dropdown on outside click
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  /** Close and hand focus back to the trigger, so keyboard users are not dropped onto the body. */
  function closeAndRestoreFocus() {
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  // Keyboard navigation
  function handleKeyDown(event: React.KeyboardEvent) {
    if (disabled) return;

    if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault();
        closeAndRestoreFocus();
      }
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        const currentIndex = ACCOUNT_TYPE_OPTIONS.findIndex((opt) => opt.type === currentType);
        const nextIndex =
          event.key === 'ArrowDown'
            ? (currentIndex + 1) % ACCOUNT_TYPE_OPTIONS.length
            : (currentIndex - 1 + ACCOUNT_TYPE_OPTIONS.length) % ACCOUNT_TYPE_OPTIONS.length;
        const nextOption = ACCOUNT_TYPE_OPTIONS[nextIndex];
        if (nextOption) {
          onChange(nextOption.type);
        }
      }
    }
  }

  return (
    <div className="space-y-2" ref={containerRef} onKeyDown={handleKeyDown}>
      <Label id="account-type-label">Account Type</Label>

      {/*
        Dropdown Menu Trigger. Its `px-4 py-2.5 text-sm` matches INPUT_CLASSES
        exactly, so the trigger and the text inputs below it share a height and
        line up on the same edges.
      */}
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          id="account-type-trigger"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-labelledby="account-type-label account-type-trigger"
          aria-describedby={ACCOUNT_TYPE_GUIDANCE_ID}
          disabled={disabled}
          onClick={() => setIsOpen((prev) => !prev)}
          className={`focus-visible:ring-cyan-accent flex w-full items-center justify-between rounded-xl border px-4 py-2.5 text-left text-sm transition-all duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
            isOpen
              ? 'border-cyan-accent bg-card/90 ring-cyan-accent/50 ring-1'
              : 'border-border/80 bg-card/60 hover:border-border hover:bg-card/90'
          }`}
        >
          <span className="text-foreground font-medium">{selectedOption.label}</span>

          <svg
            className={`text-muted-foreground size-4 shrink-0 transition-transform duration-200 ${
              isOpen ? 'text-cyan-accent rotate-180' : ''
            }`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Floating Dropdown Menu */}
        {isOpen && (
          <div
            role="listbox"
            aria-labelledby="account-type-label"
            className="border-border/90 animate-in fade-in-0 zoom-in-95 absolute z-50 mt-1.5 w-full rounded-xl border bg-[#0c101a] p-1 shadow-2xl backdrop-blur-xl duration-100"
          >
            {ACCOUNT_TYPE_OPTIONS.map((item) => {
              const isSelected = currentType === item.type;

              return (
                <button
                  key={item.type}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(item.type);
                    closeAndRestoreFocus();
                  }}
                  className={`focus-visible:ring-cyan-accent flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors duration-100 focus-visible:ring-2 focus-visible:outline-none ${
                    isSelected
                      ? 'bg-[#162235] font-medium text-cyan-300'
                      : 'text-foreground/90 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span>{item.label}</span>

                  {isSelected && (
                    <svg
                      className="text-cyan-accent size-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/*
        Account-type guidance. Sits directly beneath the control and is announced
        with it via aria-describedby. aria-live keeps a screen reader informed
        when the requirement changes, rather than only on a later visit to the
        field.
      */}
      <p
        id={ACCOUNT_TYPE_GUIDANCE_ID}
        aria-live="polite"
        className={`flex items-start gap-1.5 text-xs leading-snug ${
          needsApproval ? 'text-amber-300/90' : 'text-cyan-accent/90'
        }`}
      >
        {needsApproval ? (
          <ShieldIcon className="mt-[0.15rem] size-3.5 shrink-0" />
        ) : (
          <InfoIcon className="mt-[0.15rem] size-3.5 shrink-0" />
        )}
        <span>{guidance}</span>
      </p>
    </div>
  );
}
