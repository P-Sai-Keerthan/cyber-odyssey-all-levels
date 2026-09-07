'use client';

import * as React from 'react';
import { Input, Label, PasswordInput, FieldError, FieldHint } from '@/components/ui/field';
import { GradientButton, type ButtonState } from '@/components/ui/gradient-button';
import { createTeamAction, type CreatedTeamData } from '@/lib/actions/team-actions';

interface CreateTeamFormProps {
  onSuccess: (team: CreatedTeamData) => void;
}

export function CreateTeamForm({ onSuccess }: CreateTeamFormProps) {
  const [teamName, setTeamName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');

  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [generalError, setGeneralError] = React.useState<string | null>(null);
  const [buttonState, setButtonState] = React.useState<ButtonState>('idle');
  const [isPending, setIsPending] = React.useState(false);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    const trimmedName = teamName.trim();

    if (!trimmedName) {
      errors['teamName'] = 'Team name is required.';
    } else if (trimmedName.length < 2 || trimmedName.length > 50) {
      errors['teamName'] = 'Team name must be between 2 and 50 characters.';
    }

    if (!password) {
      errors['password'] = 'Team password is required.';
    } else if (password.length < 6) {
      errors['password'] = 'Team password must be at least 6 characters.';
    }

    if (!confirmPassword) {
      errors['confirmPassword'] = 'Confirm the team password.';
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
    formData.append('teamName', teamName);
    formData.append('password', password);
    formData.append('confirmPassword', confirmPassword);

    try {
      const result = await createTeamAction(formData);

      if (!result.success || !result.data) {
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
      onSuccess(result.data);
    } catch {
      setIsPending(false);
      setButtonState('error');
      setGeneralError('Network communication error. Please try again.');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* Team Name */}
      <div className="space-y-1.5">
        <Label htmlFor="create-team-name">Team Name</Label>
        <Input
          id="create-team-name"
          name="teamName"
          type="text"
          autoComplete="off"
          spellCheck={false}
          required
          disabled={isPending}
          value={teamName}
          onChange={(e) => {
            setTeamName(e.target.value);
            clearError('teamName');
          }}
          placeholder="e.g. CYBER PHANTOMS"
          aria-invalid={Boolean(fieldErrors['teamName'])}
          aria-describedby={
            fieldErrors['teamName'] ? 'create-team-name-error' : 'create-team-name-hint'
          }
        />
        {fieldErrors['teamName'] ? (
          <FieldError id="create-team-name-error">{fieldErrors['teamName']}</FieldError>
        ) : (
          <FieldHint id="create-team-name-hint">
            Choose a unique operational callsign for your unit.
          </FieldHint>
        )}
      </div>

      {/* Team Password */}
      <div className="space-y-1.5">
        <Label htmlFor="create-team-password">Team Password</Label>
        <PasswordInput
          id="create-team-password"
          name="password"
          autoComplete="new-password"
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
            fieldErrors['password'] ? 'create-team-password-error' : 'create-team-password-hint'
          }
        />
        {fieldErrors['password'] ? (
          <FieldError id="create-team-password-error">{fieldErrors['password']}</FieldError>
        ) : (
          <FieldHint id="create-team-password-hint">
            Teammates will need this password along with the Team ID to join.
          </FieldHint>
        )}
      </div>

      {/* Confirm Team Password */}
      <div className="space-y-1.5">
        <Label htmlFor="create-team-confirm-password">Confirm Team Password</Label>
        <PasswordInput
          id="create-team-confirm-password"
          name="confirmPassword"
          autoComplete="new-password"
          required
          disabled={isPending}
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            clearError('confirmPassword');
          }}
          placeholder="••••••••"
          aria-invalid={Boolean(fieldErrors['confirmPassword'])}
          aria-describedby={
            fieldErrors['confirmPassword'] ? 'create-team-confirm-error' : undefined
          }
        />
        {fieldErrors['confirmPassword'] && (
          <FieldError id="create-team-confirm-error">{fieldErrors['confirmPassword']}</FieldError>
        )}
      </div>

      {/* Capacity Note */}
      <div className="border-border/70 bg-card/40 text-muted-foreground rounded-xl border p-3 font-mono text-xs">
        <p>
          <strong className="text-cyan-accent">TEAM CAPACITY:</strong> Each team can contain 1–3
          participants. As Team Head, you will automatically become Member 1 of this team.
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
        variant="magenta"
        fullWidth
        status={buttonState}
        disabled={isPending}
        className="text-sm font-semibold tracking-wider uppercase"
      >
        {isPending
          ? 'Creating Team...'
          : buttonState === 'error'
            ? 'Retry Creating Team'
            : 'Establish Team'}
      </GradientButton>
    </form>
  );
}
