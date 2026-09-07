'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Input, Label, PasswordInput, FieldError, FieldHint } from '@/components/ui/field';
import { GradientButton, type ButtonState } from '@/components/ui/gradient-button';
import { AuthFormAlert } from '@/components/auth/auth-form-alert';
import { loginAction } from '@/lib/actions/auth-actions';

export function LoginForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [generalError, setGeneralError] = React.useState<string | null>(null);
  const [buttonState, setButtonState] = React.useState<ButtonState>('idle');
  const [isPending, setIsPending] = React.useState(false);
  const [showForgotNotice, setShowForgotNotice] = React.useState(false);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    const trimmedId = identifier.trim();

    if (!trimmedId) {
      errors['identifier'] = 'Please enter your email address or username.';
    }

    if (!password) {
      errors['password'] = 'Please enter your password.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Prevent duplicate submissions under high concurrency
    if (isPending) return;

    setGeneralError(null);

    const isValid = validate();
    if (!isValid) {
      setButtonState('error');
      return;
    }

    setIsPending(true);
    setButtonState('loading');

    const formData = new FormData();
    formData.append('identifier', identifier);
    formData.append('password', password);

    try {
      const result = await loginAction(formData);

      if (!result.success) {
        setIsPending(false);
        setButtonState('error');
        if (result.fieldErrors) {
          setFieldErrors(result.fieldErrors);
        }
        if (result.error) {
          setGeneralError(result.error);
        }
        return;
      }

      setButtonState('success');
      if (result.redirectTo) {
        router.push(result.redirectTo);
        router.refresh();
      }
    } catch {
      setIsPending(false);
      setButtonState('error');
      setGeneralError('Network communication error. Please check connection and try again.');
    }
  }

  function clearError(key: string) {
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      if (buttonState === 'error') {
        setButtonState('idle');
      }
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/*
          Form-level errors lead the form. A credential failure is not tied to a
          single field — it is a statement about the submission as a whole — and
          at the top it is visible without scrolling and is the first thing read
          back when focus returns to the form.

          The message is whatever the server returned, verbatim: `loginAction`
          answers "no such account" and "wrong password" with one identical
          string, and passing it through unaltered is what keeps the form from
          becoming an account-enumeration oracle.
        */}
        <AuthFormAlert>{generalError}</AuthFormAlert>

        {/* Email or Username Field */}
        <div className="space-y-2">
          <Label htmlFor="identifier">Email or Username</Label>
          <Input
            id="identifier"
            name="identifier"
            type="text"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={isPending}
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value);
              clearError('identifier');
            }}
            placeholder="participant1@acn.org or username"
            aria-invalid={Boolean(fieldErrors['identifier'])}
            aria-describedby={fieldErrors['identifier'] ? 'identifier-error' : 'identifier-hint'}
          />
          {fieldErrors['identifier'] ? (
            <FieldError id="identifier-error">{fieldErrors['identifier']}</FieldError>
          ) : (
            <FieldHint id="identifier-hint">
              Sign in with your registered email address or username.
            </FieldHint>
          )}
        </div>

        {/* Password Field */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="password">Password</Label>
            <button
              type="button"
              aria-expanded={showForgotNotice}
              aria-controls="forgot-password-notice"
              onClick={() => setShowForgotNotice((prev) => !prev)}
              className="text-cyan-accent focus-visible:ring-cyan-accent shrink-0 rounded font-mono text-[11px] hover:text-cyan-300 hover:underline focus-visible:ring-1 focus-visible:outline-none"
            >
              Forgot password?
            </button>
          </div>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            required
            disabled={isPending}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError('password');
            }}
            placeholder="••••••••••••••••"
            aria-invalid={Boolean(fieldErrors['password'])}
            aria-describedby={fieldErrors['password'] ? 'password-error' : undefined}
          />
          {fieldErrors['password'] && (
            <FieldError id="password-error">{fieldErrors['password']}</FieldError>
          )}
        </div>

        {/* Forgot password informational callout */}
        {showForgotNotice && (
          <div
            id="forgot-password-notice"
            role="region"
            aria-label="Password Reset Instructions"
            className="border-cyan-accent/30 rounded-xl border bg-cyan-950/20 p-3.5 font-mono text-xs text-cyan-200/90"
          >
            <p className="font-semibold text-cyan-400">PASSWORD RECOVERY:</p>
            <p className="mt-1 leading-relaxed">
              During competition hours, password resets are processed on-site by event marshals at
              the Command Desk. Please have your team ID ready.
            </p>
          </div>
        )}

        {/* Submit Button with Concurrency Protection and Explicit State Feedback */}
        <GradientButton
          type="submit"
          variant="magenta"
          fullWidth
          status={buttonState}
          disabled={isPending}
          className="text-sm font-semibold tracking-wider uppercase"
        >
          {isPending ? 'Authenticating...' : buttonState === 'error' ? 'Retry Sign In' : 'Sign In'}
        </GradientButton>
      </form>

      {/* Navigation Link to Signup */}
      <div className="border-border/60 text-muted-foreground border-t pt-4 text-center text-xs">
        Don&apos;t have an account?{' '}
        <Link
          href="/signup"
          className="text-cyan-accent focus-visible:ring-cyan-accent rounded font-medium hover:text-cyan-300 hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          Create Account
        </Link>
      </div>
    </div>
  );
}
