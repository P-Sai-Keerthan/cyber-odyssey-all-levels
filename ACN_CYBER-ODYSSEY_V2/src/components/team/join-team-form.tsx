'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Input, Label, PasswordInput, FieldError, FieldHint } from '@/components/ui/field';
import { GradientButton, type ButtonState } from '@/components/ui/gradient-button';
import { joinTeamAction } from '@/lib/actions/team-actions';

export function JoinTeamForm() {
  const router = useRouter();
  const [teamCode, setTeamCode] = React.useState('');
  const [password, setPassword] = React.useState('');

  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [generalError, setGeneralError] = React.useState<string | null>(null);
  const [buttonState, setButtonState] = React.useState<ButtonState>('idle');
  const [isPending, setIsPending] = React.useState(false);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    const trimmedCode = teamCode.trim();

    if (!trimmedCode) {
      errors['teamCode'] = 'Please enter the Team ID / Joining Code.';
    }

    if (!password) {
      errors['password'] = 'Please enter the team password.';
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
    formData.append('teamCode', teamCode);
    formData.append('password', password);

    try {
      const result = await joinTeamAction(formData);

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
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* Team Code */}
      <div className="space-y-1.5">
        <Label htmlFor="join-team-code">Team ID / Joining Code</Label>
        <Input
          id="join-team-code"
          name="teamCode"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          disabled={isPending}
          value={teamCode}
          onChange={(e) => {
            setTeamCode(e.target.value.toUpperCase());
            clearError('teamCode');
          }}
          placeholder="e.g. CYB-7K4M2"
          className="font-mono tracking-widest uppercase"
          aria-invalid={Boolean(fieldErrors['teamCode'])}
          aria-describedby={
            fieldErrors['teamCode'] ? 'join-team-code-error' : 'join-team-code-hint'
          }
        />
        {fieldErrors['teamCode'] ? (
          <FieldError id="join-team-code-error">{fieldErrors['teamCode']}</FieldError>
        ) : (
          <FieldHint id="join-team-code-hint">
            Obtain this 5-character identifier from your Team Head.
          </FieldHint>
        )}
      </div>

      {/* Team Password */}
      <div className="space-y-1.5">
        <Label htmlFor="join-team-password">Team Password</Label>
        <PasswordInput
          id="join-team-password"
          name="password"
          autoComplete="current-password"
          required
          disabled={isPending}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearError('password');
          }}
          placeholder="••••••••"
          aria-invalid={Boolean(fieldErrors['password'])}
          aria-describedby={
            fieldErrors['password'] ? 'join-team-password-error' : 'join-team-password-hint'
          }
        />
        {fieldErrors['password'] ? (
          <FieldError id="join-team-password-error">{fieldErrors['password']}</FieldError>
        ) : (
          <FieldHint id="join-team-password-hint">
            The security password set during team creation.
          </FieldHint>
        )}
      </div>

      {/* Concurrency & Cap Notice */}
      <div className="border-border/70 bg-card/40 text-muted-foreground rounded-xl border p-3 font-mono text-xs">
        <p>
          <strong className="text-cyan-accent">TEAM SIZE LIMIT:</strong> Maximum 3 participants.
          Joining is confirmed in real-time.
        </p>
      </div>

      {/* General Error Banner */}
      {generalError && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-xl border p-3.5 font-mono text-xs"
        >
          {generalError}
        </div>
      )}

      {/* Submit Button */}
      <GradientButton
        type="submit"
        variant="cyan"
        fullWidth
        status={buttonState}
        disabled={isPending}
        className="text-sm font-semibold tracking-wider uppercase"
      >
        {isPending
          ? 'Joining Team...'
          : buttonState === 'error'
            ? 'Retry Join'
            : 'Join Investigation Team'}
      </GradientButton>
    </form>
  );
}
