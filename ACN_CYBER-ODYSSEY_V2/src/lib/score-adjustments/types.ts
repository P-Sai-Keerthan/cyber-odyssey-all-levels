import { z } from 'zod';

export const SCORE_ADJUSTMENT_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type ScoreAdjustmentStatus =
  (typeof SCORE_ADJUSTMENT_STATUS)[keyof typeof SCORE_ADJUSTMENT_STATUS];

export const ScoreAdjustmentLevel = {
  LEVEL_1: 1,
  LEVEL_2: 2,
  LEVEL_3: 3,
} as const;

export type ScoreAdjustmentLevel = (typeof ScoreAdjustmentLevel)[keyof typeof ScoreAdjustmentLevel];

export const SCORE_ADJUSTMENT_LEVELS = [1, 2, 3] as const;

export const MAX_SCORE_ADJUSTMENT_POINTS = 100_000;
export const MIN_SCORE_ADJUSTMENT_POINTS = 1;

/**
 * Normalizes various level representations ('LEVEL_1', '1', 1) to integer level (1, 2, 3).
 * Throws or returns null if invalid.
 */
export function normalizeScoreAdjustmentLevel(input: unknown): ScoreAdjustmentLevel | null {
  if (typeof input === 'number' && (input === 1 || input === 2 || input === 3)) {
    return input as ScoreAdjustmentLevel;
  }
  if (typeof input === 'string') {
    const trimmed = input.trim().toUpperCase();
    if (trimmed === 'LEVEL_1' || trimmed === '1' || trimmed === 'LEVEL 1') return 1;
    if (trimmed === 'LEVEL_2' || trimmed === '2' || trimmed === 'LEVEL 2') return 2;
    if (trimmed === 'LEVEL_3' || trimmed === '3' || trimmed === 'LEVEL 3') return 3;
  }
  return null;
}

export function isValidScoreAdjustmentLevel(level: unknown): level is ScoreAdjustmentLevel {
  return normalizeScoreAdjustmentLevel(level) !== null;
}

export const requestScoreAdjustmentSchema = z.object({
  teamId: z.string().min(1, 'Team ID is required'),
  level: z
    .unknown()
    .refine((val) => normalizeScoreAdjustmentLevel(val) !== null, {
      message: 'Level must be LEVEL 1, LEVEL 2, or LEVEL 3',
    })
    .transform((val) => normalizeScoreAdjustmentLevel(val)!),
  points: z
    .number()
    .int('Points must be an integer')
    .min(MIN_SCORE_ADJUSTMENT_POINTS, `Points must be at least ${MIN_SCORE_ADJUSTMENT_POINTS}`)
    .max(MAX_SCORE_ADJUSTMENT_POINTS, `Points cannot exceed ${MAX_SCORE_ADJUSTMENT_POINTS}`),
  reason: z
    .string()
    .min(
      10,
      'Justification must be at least 10 characters explaining the basis for additional points',
    ),
  evidenceNote: z.string().optional().nullable(),
});

export type RequestScoreAdjustmentInput = z.infer<typeof requestScoreAdjustmentSchema>;

export const reviewScoreAdjustmentSchema = z.object({
  adjustmentId: z.string().min(1, 'Adjustment ID is required'),
  rejectionReason: z.string().optional().nullable(),
});

export interface ScoreAdjustmentDTO {
  id: string;
  teamId: string;
  teamName: string;
  level: number;
  points: number;
  reason: string;
  evidenceNote: string | null;
  status: ScoreAdjustmentStatus;
  requestedByUserId: string;
  requestedByUsername: string;
  reviewedByUserId: string | null;
  reviewedByUsername: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}
