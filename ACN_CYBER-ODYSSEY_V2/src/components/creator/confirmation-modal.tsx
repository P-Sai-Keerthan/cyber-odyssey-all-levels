'use client';

import * as React from 'react';

export interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  isPending?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmationModal({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm Action',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isPending) {
        onCancel();
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isPending, onCancel]);

  if (!isOpen) return null;

  const confirmBtnStyles =
    variant === 'danger'
      ? 'border-rose-500/50 bg-rose-950/80 text-rose-200 hover:bg-rose-900/90 hover:text-white hover:border-rose-400 focus-visible:ring-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.3)]'
      : variant === 'warning'
        ? 'border-amber-500/50 bg-amber-950/80 text-amber-200 hover:bg-amber-900/90 hover:text-white hover:border-amber-400 focus-visible:ring-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
        : 'border-cyan-500/50 bg-cyan-950/80 text-cyan-200 hover:bg-cyan-900/90 hover:text-white hover:border-cyan-400 focus-visible:ring-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmation-modal-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={() => !isPending && onCancel()}
        aria-hidden="true"
      />

      {/* Modal Dialog */}
      <div className="border-border/80 bg-card/95 relative z-10 w-full max-w-md space-y-5 rounded-2xl border p-6 shadow-2xl backdrop-blur-2xl">
        <div className="flex items-start gap-4">
          <div
            className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${
              variant === 'danger'
                ? 'border-rose-500/40 bg-rose-950/50 text-rose-400'
                : variant === 'warning'
                  ? 'border-amber-500/40 bg-amber-950/50 text-amber-400'
                  : 'border-cyan-500/40 bg-cyan-950/50 text-cyan-400'
            }`}
          >
            {variant === 'danger' ? (
              <svg
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            ) : (
              <svg
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
          </div>

          <div className="space-y-1.5">
            <h3
              id="confirmation-modal-title"
              className="text-lg font-bold tracking-tight text-white"
            >
              {title}
            </h3>
            <p className="text-muted-foreground font-mono text-xs leading-relaxed sm:text-xs">
              {description}
            </p>
          </div>
        </div>

        <div className="border-border/60 flex items-center justify-end gap-3 border-t pt-4">
          <button
            type="button"
            disabled={isPending}
            onClick={onCancel}
            className="border-border/80 bg-card/60 text-muted-foreground hover:border-border hover:bg-card hover:text-foreground focus-visible:ring-cyan-accent rounded-xl border px-4 py-2 font-mono text-xs font-semibold transition-colors focus-visible:ring-1 focus-visible:outline-none disabled:opacity-50"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            disabled={isPending}
            onClick={onConfirm}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2 font-mono text-xs font-semibold transition-all focus-visible:ring-1 focus-visible:outline-none disabled:opacity-50 ${confirmBtnStyles}`}
          >
            {isPending && (
              <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
