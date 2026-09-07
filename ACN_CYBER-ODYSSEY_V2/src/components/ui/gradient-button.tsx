import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export type ButtonState = 'idle' | 'loading' | 'success' | 'error';

const gradientButtonVariants = cva(
  'group relative inline-flex items-center justify-center overflow-hidden rounded-xl font-medium tracking-wide transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer active:scale-[0.98]',
  {
    variants: {
      variant: {
        magenta:
          'text-white shadow-[0_0_20px_-5px_rgba(217,70,239,0.3)] hover:shadow-[0_0_25px_rgba(217,70,239,0.5)] focus-visible:ring-fuchsia-500',
        cyan: 'text-white shadow-[0_0_20px_-5px_rgba(6,182,212,0.3)] hover:shadow-[0_0_25px_rgba(6,182,212,0.5)] focus-visible:ring-cyan-400',
        outline:
          'border border-border/80 bg-card/60 text-foreground hover:bg-card hover:border-border hover:text-white focus-visible:ring-ring',
        ghost:
          'bg-transparent text-muted-foreground hover:bg-card/50 hover:text-foreground focus-visible:ring-ring',
      },
      size: {
        default: 'h-11 px-5 py-2.5 text-sm',
        sm: 'h-9 px-3.5 py-1.5 text-xs rounded-lg',
        lg: 'h-12 px-7 py-3 text-base rounded-xl',
        icon: 'size-10 rounded-lg',
      },
      fullWidth: {
        true: 'w-full',
        false: 'w-auto',
      },
    },
    defaultVariants: {
      variant: 'magenta',
      size: 'default',
      fullWidth: false,
    },
  },
);

export interface GradientButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof gradientButtonVariants> {
  status?: ButtonState;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const GradientButton = React.forwardRef<HTMLButtonElement, GradientButtonProps>(
  (
    {
      className,
      variant = 'magenta',
      size,
      fullWidth,
      status = 'idle',
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const isMagenta = variant === 'magenta' || variant === null || variant === undefined;
    const isCyan = variant === 'cyan';
    const isBusy = isLoading || status === 'loading';
    const isSuccess = status === 'success';
    const isError = status === 'error';

    return (
      <button
        ref={ref}
        disabled={disabled || isBusy}
        aria-busy={isBusy}
        className={cn(
          gradientButtonVariants({ variant, size, fullWidth, className }),
          isSuccess && 'shadow-[0_0_20px_rgba(34,197,94,0.4)]',
          isError && 'shadow-[0_0_20px_rgba(239,68,68,0.4)]',
        )}
        {...props}
      >
        {/* Subtle Gradient Border Layer */}
        {isMagenta && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-0 rounded-[inherit] bg-gradient-to-r from-fuchsia-500 via-rose-500 to-amber-500 p-[1px] opacity-90 transition-opacity duration-200 group-hover:opacity-100',
              isSuccess && 'from-emerald-400 via-teal-400 to-green-500',
              isError && 'from-red-500 via-rose-600 to-amber-500',
            )}
          >
            <span
              className={cn(
                'via-background to-background block h-full w-full rounded-[calc(0.75rem-1px)] bg-[#0d0714]/90 bg-gradient-to-b from-fuchsia-950/40 group-hover:from-fuchsia-900/50',
                isSuccess && 'bg-[#04120a]/90 from-emerald-950/50',
                isError && 'bg-[#140608]/90 from-rose-950/50',
              )}
            />
          </span>
        )}

        {isCyan && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-0 rounded-[inherit] bg-gradient-to-r from-cyan-400 via-teal-400 to-lime-400 p-[1px] opacity-90 transition-opacity duration-200 group-hover:opacity-100',
              isSuccess && 'from-emerald-400 via-teal-400 to-green-500',
              isError && 'from-red-500 via-rose-600 to-amber-500',
            )}
          >
            <span
              className={cn(
                'via-background to-background block h-full w-full rounded-[calc(0.75rem-1px)] bg-[#040e16]/90 bg-gradient-to-b from-cyan-950/40 group-hover:from-cyan-900/50',
                isSuccess && 'bg-[#04120a]/90 from-emerald-950/50',
                isError && 'bg-[#140608]/90 from-rose-950/50',
              )}
            />
          </span>
        )}

        {/* Content Container */}
        <span className="relative z-10 flex items-center justify-center gap-2">
          {isBusy && (
            <svg
              className="size-4 shrink-0 animate-spin text-current"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          )}

          {isSuccess && (
            <svg
              className="size-4 shrink-0 text-emerald-400"
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

          {isError && (
            <svg
              className="size-4 shrink-0 text-rose-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}

          {!isBusy && !isSuccess && !isError && leftIcon && (
            <span className="shrink-0">{leftIcon}</span>
          )}
          <span className="truncate">{children}</span>
          {!isBusy && !isSuccess && !isError && rightIcon && (
            <span className="shrink-0">{rightIcon}</span>
          )}
        </span>
      </button>
    );
  },
);

GradientButton.displayName = 'GradientButton';
