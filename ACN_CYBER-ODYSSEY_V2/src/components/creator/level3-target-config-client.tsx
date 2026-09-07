'use client';

import * as React from 'react';
import {
  setLevel3TargetIpAction,
  setLevel3Track2ReleasedAction,
} from '@/lib/actions/level3-config-actions';
import type { Level3TargetConfig } from '@/lib/level3/target-config';
import { formatDateTime } from '@/lib/utils/date-formatter';

export interface Level3TargetConfigClientProps {
  initialConfig: Level3TargetConfig;
  /** Report + Response criteria maxima, read from the database on the server. */
  reportPoints: number;
  responsePoints: number;
}

/**
 * Creator console — Level 3 target configuration.
 *
 * Lives on the existing `/creator/resources/level-3` page, beside the sample
 * report the Creator already manages there. It is deliberately NOT a new
 * standalone admin area: everything a Creator configures for Level 3 belongs on
 * one screen, and a second page would be a second place to forget.
 *
 * Client-side checks here are for FEEDBACK ONLY. Every value is re-validated in
 * the server action, which is the only thing that can write.
 */
export function Level3TargetConfigClient({
  initialConfig,
  reportPoints,
  responsePoints,
}: Level3TargetConfigClientProps) {
  const [config, setConfig] = React.useState<Level3TargetConfig>(initialConfig);
  const [draftIp, setDraftIp] = React.useState<string>(initialConfig.targetIp ?? '');
  const [isEditing, setIsEditing] = React.useState<boolean>(!initialConfig.targetIp);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isTogglingTrack, setIsTogglingTrack] = React.useState(false);
  const [message, setMessage] = React.useState<{ text: string; isError?: boolean } | null>(null);

  const hasTarget = config.targetIp !== null;

  async function saveTargetIp(value: string) {
    setIsSaving(true);
    setMessage(null);
    const res = await setLevel3TargetIpAction(value);
    if (res.success && res.data) {
      setConfig(res.data);
      setDraftIp(res.data.targetIp ?? '');
      setIsEditing(res.data.targetIp === null);
      setMessage({
        text:
          res.data.targetIp === null
            ? 'Target IP cleared. Participants now see “TARGET NOT YET ASSIGNED”.'
            : `Target IP set to ${res.data.targetIp}. Participants see it on their next Level 3 load.`,
      });
    } else {
      setMessage({ text: res.error || 'Failed to update the target address.', isError: true });
    }
    setIsSaving(false);
  }

  async function toggleTrack2() {
    setIsTogglingTrack(true);
    setMessage(null);
    const res = await setLevel3Track2ReleasedAction(!config.track2Released);
    if (res.success && res.data) {
      setConfig(res.data);
      setMessage({
        text: `Track 2 ${res.data.track2Released ? 'RELEASED' : 'withdrawn'}. Available discovery score is now ${res.data.availableDiscoveryPoints.toLocaleString()} PTS.`,
      });
    } else {
      setMessage({ text: res.error || 'Failed to change Track 2 release state.', isError: true });
    }
    setIsTogglingTrack(false);
  }

  const availableTotal = config.availableDiscoveryPoints + reportPoints + responsePoints;

  return (
    <div className="border-border/80 bg-card/60 space-y-6 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
      {/* Header */}
      <div className="border-border/50 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎯</span>
          <h2 className="text-sm font-bold text-white uppercase">Level 3 Target Configuration</h2>
        </div>
        <span
          className={`rounded-md border px-2.5 py-0.5 text-[10px] font-bold uppercase ${
            hasTarget
              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
              : 'border-amber-500/40 bg-amber-950/40 text-amber-300'
          }`}
        >
          {hasTarget ? 'TARGET CONFIGURED' : 'NO TARGET IP CONFIGURED'}
        </span>
      </div>

      <p className="text-muted-foreground font-sans text-xs leading-relaxed">
        The address participants see under <strong className="text-white">Target Context</strong> on
        the Level 3 page. It is a display value: the portal never connects to it, resolves it, or
        forwards anything to it.
      </p>

      {message && (
        <div
          className={`rounded-xl border p-3.5 text-xs ${
            message.isError
              ? 'border-rose-500/40 bg-rose-950/40 text-rose-300'
              : 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.15)]'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* ---- TARGET IP ---- */}
      <div className="border-border/60 bg-background/50 space-y-4 rounded-xl border p-4">
        <span className="text-muted-foreground block text-[10px] font-bold uppercase">
          Target IP Address
        </span>

        {!isEditing && hasTarget ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span
              data-testid="creator-current-target-ip"
              className="text-xl font-black tracking-wider text-cyan-300 tabular-nums"
            >
              {config.targetIp}
            </span>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="rounded-xl border border-cyan-500/50 bg-cyan-950/40 px-4 py-2 text-xs font-bold text-cyan-300 transition-colors hover:bg-cyan-900/60"
              >
                EDIT
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void saveTargetIp('')}
                className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-4 py-2 text-xs font-bold text-rose-300 transition-colors hover:bg-rose-900/60 disabled:opacity-50"
              >
                REMOVE
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveTargetIp(draftIp);
            }}
            className="space-y-3"
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="level3-target-ip"
                name="targetIp"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={64}
                value={draftIp}
                onChange={(e) => setDraftIp(e.target.value)}
                disabled={isSaving}
                placeholder="e.g. 10.20.30.40"
                aria-label="Level 3 target IPv4 address"
                className="border-border/80 bg-background/90 placeholder:text-muted-foreground/60 w-full rounded-xl border p-2.5 text-sm font-bold tracking-wider text-cyan-200 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isSaving}
                className="shrink-0 rounded-xl border border-cyan-400 bg-cyan-500 px-5 py-2.5 text-xs font-black text-black transition-all hover:bg-cyan-400 disabled:opacity-50"
              >
                {isSaving ? 'SAVING…' : hasTarget ? 'SAVE TARGET' : 'ADD TARGET IP'}
              </button>
              {hasTarget && (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => {
                    setDraftIp(config.targetIp ?? '');
                    setIsEditing(false);
                    setMessage(null);
                  }}
                  className="border-border bg-card text-muted-foreground shrink-0 rounded-xl border px-4 py-2.5 text-xs font-bold transition-colors hover:text-white disabled:opacity-50"
                >
                  CANCEL
                </button>
              )}
            </div>
            <p className="text-muted-foreground text-[11px]">
              IPv4 only, dotted-quad, no leading zeros. Leave empty and save to clear the target.
            </p>
          </form>
        )}
      </div>

      {/* ---- TRACK RELEASE + SCORING SUMMARY ---- */}
      <div className="border-border/60 bg-background/50 space-y-4 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground text-[10px] font-bold uppercase">
            Available Score Configuration
          </span>
          <span
            className={`rounded-md border px-2.5 py-0.5 text-[10px] font-bold uppercase ${
              config.track2Released
                ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                : 'border-border bg-background/60 text-muted-foreground'
            }`}
          >
            {config.track2Released ? 'TRACK 2 RELEASED' : 'TRACK 2 NOT RELEASED'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground text-[10px] uppercase">Track 1</div>
            <div
              className={`text-base font-black tabular-nums ${config.track2Released ? 'text-muted-foreground' : 'text-cyan-300'}`}
            >
              {config.track1Points.toLocaleString()} PTS
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-[10px] uppercase">Track 2 (cumulative)</div>
            <div
              className={`text-base font-black tabular-nums ${config.track2Released ? 'text-cyan-300' : 'text-muted-foreground'}`}
            >
              {config.track2Points.toLocaleString()} PTS
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-[10px] uppercase">Report + Response</div>
            <div className="text-base font-black text-emerald-300 tabular-nums">
              {(reportPoints + responsePoints).toLocaleString()} PTS
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-[10px] uppercase">Available Now</div>
            <div className="text-base font-black text-amber-300 tabular-nums">
              {availableTotal.toLocaleString()} PTS
            </div>
          </div>
        </div>

        <p className="text-muted-foreground text-[11px] leading-relaxed">
          Track 2 is the <strong className="text-white">cumulative</strong> figure — releasing it
          replaces the Track 1 ceiling rather than adding to it. Report and Response maxima come
          from the Level 3 evaluation criteria and are edited in Admin → Evaluations.
        </p>

        <div className="border-border/40 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <span className="text-muted-foreground text-[11px]">
            Last changed: {config.updatedAt ? formatDateTime(config.updatedAt) : '—'}
          </span>
          <button
            type="button"
            onClick={() => void toggleTrack2()}
            disabled={isTogglingTrack}
            className={`rounded-xl border px-4 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${
              config.track2Released
                ? 'border-rose-500/40 bg-rose-950/30 text-rose-300 hover:bg-rose-900/60'
                : 'border-emerald-500/50 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60'
            }`}
          >
            {isTogglingTrack
              ? 'UPDATING…'
              : config.track2Released
                ? 'WITHDRAW TRACK 2'
                : 'RELEASE TRACK 2'}
          </button>
        </div>
      </div>
    </div>
  );
}
