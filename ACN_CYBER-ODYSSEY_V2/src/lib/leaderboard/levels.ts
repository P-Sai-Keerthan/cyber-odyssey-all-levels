/**
 * Leaderboard level constants, shared by server and client.
 *
 * Kept separate from `standings.ts` because that module is `server-only` (it
 * touches Prisma), while the leaderboard table component is a client component
 * that needs the same list to render its columns. Duplicating the list in the UI
 * would let the columns silently drift from the data.
 */

/** Levels shown as leaderboard columns, in display order. */
export const LEADERBOARD_LEVELS = [1, 2, 3] as const;

export type LeaderboardLevel = (typeof LEADERBOARD_LEVELS)[number];
