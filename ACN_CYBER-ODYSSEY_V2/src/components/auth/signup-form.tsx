'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Input, Label, PasswordInput, FieldError, FieldHint } from '@/components/ui/field';
import { GradientButton, type ButtonState } from '@/components/ui/gradient-button';
import {
  AccountTypeSelector,
  requiresCreatorApproval,
  type AccountType,
} from '@/components/auth/account-type-selector';
import { AuthFormAlert } from '@/components/auth/auth-form-alert';
import { registerParticipantAction } from '@/lib/actions/auth-actions';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignupForm() {
  const router = useRouter();
  const [accountType, setAccountType] = React.useState<AccountType>('PARTICIPANT');
  const [email, setEmail] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');

  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [generalError, setGeneralError] = React.useState<string | null>(null);
  const [buttonState, setButtonState] = React.useState<ButtonState>('idle');
  const [isPending, setIsPending] = React.useState(false);

  /**
   * Participants are already told which address to use by the note under the
   * Account Type control, so the email field carries no second hint for them —
   * repeating the Unstop instruction beside the input would say the same thing
   * twice in adjacent lines. Staff types, whose note is about approval rather
   * than about email, keep the ordinary email guidance.
   */
  const showsEmailHint = requiresCreatorApproval(accountType);

  function validate(): boolean {
    const errors: Record<string, string> = {};

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      errors['email'] = 'Email address is required.';
    } else if (!EMAIL_REGEX.test(trimmedEmail)) {
      errors['email'] = 'Please enter a valid email address.';
    }

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      errors['username'] = 'Please enter your username.';
    } else if (trimmedUsername.length < 2 || trimmedUsername.length > 40) {
      errors['username'] = 'Username must be between 2 and 40 characters.';
    }

    if (!password) {
      errors['password'] = 'Password is required.';
    } else if (password.length < 12) {
      errors['password'] = 'Password must be at least 12 characters long.';
    }

    if (!confirmPassword) {
      errors['confirmPassword'] = 'Confirm your password.';
    } else if (password !== confirmPassword) {
      errors['confirmPassword'] = 'Passwords do not match.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Prevent concurrent double-clicks
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
    formData.append('email', email);
    formData.append('username', username);
    formData.append('password', password);
    formData.append('confirmPassword', confirmPassword);
    formData.append('accountType', accountType);

    try {
      const result = await registerParticipantAction(formData);

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
      setGeneralError('Network communication error. Please try again.');
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* Form-level errors lead the form, matching Sign In. */}
        <AuthFormAlert>{generalError}</AuthFormAlert>

        {/*
          Account Type Selector. The account type chosen here is a REQUEST, not a
          grant: `registerParticipantAction` decides the resulting status on the
          server (PARTICIPANT becomes ACTIVE, EVALUATOR and ADMIN are held at
          PENDING_APPROVAL until a Creator approves them). The note the selector
          renders describes that server behaviour; it does not influence it.
        */}
        <AccountTypeSelector
          value={accountType}
          onChange={(type) => {
            setAccountType(type);
            setGeneralError(null);
            if (buttonState === 'error') setButtonState('idle');
          }}
          disabled={isPending}
        />

        {/* Email Address */}
        <div className="space-y-2">
          <Label htmlFor="signup-email">Email Address</Label>
          <Input
            id="signup-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={isPending}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError('email');
            }}
            placeholder="name@example.com"
            aria-invalid={Boolean(fieldErrors['email'])}
            aria-describedby={
              fieldErrors['email']
                ? 'signup-email-error'
                : showsEmailHint
                  ? 'signup-email-hint'
                  : undefined
            }
          />
          {fieldErrors['email'] ? (
            <FieldError id="signup-email-error">{fieldErrors['email']}</FieldError>
          ) : (
            showsEmailHint && (
              <FieldHint id="signup-email-hint">
                Used for account communications and sign-in.
              </FieldHint>
            )
          )}
        </div>

        {/* Username */}
        <div className="space-y-2">
          <Label htmlFor="signup-username">Username</Label>
          <Input
            id="signup-username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={isPending}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              clearError('username');
            }}
            placeholder="Enter your display name"
            aria-invalid={Boolean(fieldErrors['username'])}
            aria-describedby={
              fieldErrors['username'] ? 'signup-username-error' : 'signup-username-hint'
            }
          />
          {fieldErrors['username'] ? (
            <FieldError id="signup-username-error">{fieldErrors['username']}</FieldError>
          ) : (
            <FieldHint id="signup-username-hint">Your public display name on the portal.</FieldHint>
          )}
        </div>

        {/* Password */}
        <div className="space-y-2">
          <Label htmlFor="signup-password">Password</Label>
          <PasswordInput
            id="signup-password"
            name="password"
            autoComplete="new-password"
            required
            disabled={isPending}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError('password');
            }}
            placeholder="••••••••••••••••"
            aria-invalid={Boolean(fieldErrors['password'])}
            aria-describedby={
              fieldErrors['password'] ? 'signup-password-error' : 'signup-password-hint'
            }
          />
          {fieldErrors['password'] ? (
            <FieldError id="signup-password-error">{fieldErrors['password']}</FieldError>
          ) : (
            <FieldHint id="signup-password-hint">Minimum 12 characters required.</FieldHint>
          )}
        </div>

        {/* Confirm Password */}
        <div className="space-y-2">
          <Label htmlFor="signup-confirm-password">Confirm Password</Label>
          <PasswordInput
            id="signup-confirm-password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            disabled={isPending}
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              clearError('confirmPassword');
            }}
            placeholder="••••••••••••••••"
            aria-invalid={Boolean(fieldErrors['confirmPassword'])}
            aria-describedby={
              fieldErrors['confirmPassword'] ? 'signup-confirm-password-error' : undefined
            }
          />
          {fieldErrors['confirmPassword'] && (
            <FieldError id="signup-confirm-password-error">
              {fieldErrors['confirmPassword']}
            </FieldError>
          )}
        </div>

        {/* Submit Button */}
        <GradientButton
          type="submit"
          variant="magenta"
          fullWidth
          status={buttonState}
          disabled={isPending}
          className="text-sm font-semibold tracking-wider uppercase"
        >
          {isPending
            ? 'Creating Account...'
            : buttonState === 'error'
              ? 'Retry Registration'
              : 'Create Account'}
        </GradientButton>
      </form>

      {/* Navigation Link to Sign In */}
      <div className="border-border/60 text-muted-foreground border-t pt-4 text-center text-xs">
        Already have an account?{' '}
        <Link
          href="/login"
          className="text-cyan-accent focus-visible:ring-cyan-accent rounded font-medium hover:text-cyan-300 hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
