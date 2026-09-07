'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      'text-foreground/90 block font-mono text-xs font-semibold tracking-wider uppercase select-none',
      className,
    )}
    {...props}
  />
));
Label.displayName = 'Label';

const INPUT_CLASSES =
  'w-full rounded-xl border border-border/80 bg-card/60 px-4 py-2.5 text-sm text-foreground ' +
  'placeholder:text-muted-foreground/45 transition-all duration-150 ' +
  'focus-visible:border-cyan-accent focus-visible:ring-2 focus-visible:ring-cyan-accent/20 focus-visible:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(INPUT_CLASSES, className)} {...props} />
  ),
);
Input.displayName = 'Input';

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden="true"
    >
      {off ? (
        <>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <path d="m2 2 20 20" />
        </>
      ) : (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<'input'> & { containerClassName?: string }
>(({ className, containerClassName, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className={cn('relative w-full', containerClassName)}>
      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        className={cn('pe-11', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        disabled={props.disabled ?? false}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-cyan-accent/50 absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-r-xl transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
      >
        <EyeIcon off={visible} />
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';

export function FieldError({ children, id }: { children?: React.ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p
      id={id}
      role="alert"
      className="text-destructive font-mono text-xs font-medium tracking-tight"
    >
      {children}
    </p>
  );
}

export function FieldHint({ children, id }: { children?: React.ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} className="text-muted-foreground text-xs leading-relaxed">
      {children}
    </p>
  );
}
