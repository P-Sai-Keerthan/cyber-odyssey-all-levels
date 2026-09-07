import * as React from 'react';

/**
 * Form-level error banner shared by Sign In and Create Account.
 *
 * Both forms previously carried their own copy of this markup, which is why the
 * two pages could drift apart visually. One component keeps them identical.
 *
 * PRESENTATION ONLY. The message text is passed straight through from the
 * server action — this component never composes, rewrites, or classifies an
 * authentication error. That matters for account enumeration: `loginAction`
 * returns one uniform message for "no such account" and "wrong password", and
 * rendering it verbatim is what keeps the two indistinguishable.
 *
 * `role="alert"` makes the message announce itself as soon as it appears.
 */
export function AuthFormAlert({ children }: { children?: React.ReactNode }) {
  if (!children) return null;

  return (
    <div
      role="alert"
      className="border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2.5 rounded-xl border p-3.5 font-mono text-xs leading-relaxed"
    >
      <svg
        className="mt-px size-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{children}</span>
    </div>
  );
}
