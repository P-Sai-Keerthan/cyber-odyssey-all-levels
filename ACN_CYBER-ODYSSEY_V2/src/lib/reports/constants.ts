/**
 * Shared constants for Admin → Creator issue reports.
 *
 * These live OUTSIDE the server-action module on purpose. A file marked
 * `'use server'` may only export async functions — Next.js turns every export
 * into a callable server endpoint, so exporting a plain array from one fails the
 * build with "A 'use server' file can only export async functions, found object."
 *
 * Client components need these values to render the issue-type selector, so they
 * belong in an ordinary module that both sides can import.
 */

export const REPORT_ISSUE_TYPES = [
  'TEAM_CONDUCT',
  'PARTICIPANT_CONDUCT',
  'TECHNICAL',
  'SUBMISSION',
  'OTHER',
] as const;

export type ReportIssueType = (typeof REPORT_ISSUE_TYPES)[number];

export const REPORT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Human-readable labels, kept beside the values so they cannot drift. */
export const REPORT_ISSUE_LABELS: Record<ReportIssueType, string> = {
  TEAM_CONDUCT: 'Squad conduct',
  PARTICIPANT_CONDUCT: 'Participant conduct',
  TECHNICAL: 'Technical problem',
  SUBMISSION: 'Submission issue',
  OTHER: 'Other',
};

export function isReportIssueType(value: string): value is ReportIssueType {
  return (REPORT_ISSUE_TYPES as readonly string[]).includes(value);
}
