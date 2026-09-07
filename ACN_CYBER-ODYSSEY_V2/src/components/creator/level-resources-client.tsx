'use client';

import * as React from 'react';
import {
  uploadOrReplaceLevelResourceAction,
  removeLevelResourceAction,
} from '@/lib/actions/creator-resource-actions';
import { ConfirmationModal } from '@/components/creator/confirmation-modal';
import type { LevelResourceMeta } from '@/lib/event/level-resources';
import { formatDateTime } from '@/lib/utils/date-formatter';

export interface LevelResourcesClientProps {
  initialResources: LevelResourceMeta[];
  levelNumber?: number;
  levelName?: string;
  levelDescription?: string;
}

export function LevelResourcesClient({
  initialResources,
  levelNumber = 2,
  levelName,
  levelDescription,
}: LevelResourcesClientProps) {
  const isLevel3 = levelNumber === 3;
  const vaultLabel = isLevel3
    ? 'ASSET VAULT // LEVEL 3 MATERIALS'
    : 'ASSET VAULT // LEVEL 2 MATERIALS';
  const pageTitle = isLevel3 ? 'Level 3 Resource Management' : 'Level 2 Resource Management';
  const codename = levelName || (isLevel3 ? 'ORION Network' : "The Boar's Mark");
  const defaultDesc = `Upload, replace, and manage downloadable challenge packages and reference materials for Level ${levelNumber} ("${codename}").`;
  const pageDesc = levelDescription || defaultDesc;

  const evidenceDesc = isLevel3
    ? 'Official downloadable challenge asset archive containing target network maps, protocol specifications, and system dumps for Level 3.'
    : 'Official downloadable forensic evidence ZIP archive containing raw packet captures, memory segments, and Kerberos logs.';

  const sampleReportDesc = isLevel3
    ? 'Official reference rubric and sample vulnerability disclosure report PDF for Level 3.'
    : 'Official reference rubric and sample investigation report PDF illustrating expected deliverable structure.';

  const [resources, setResources] = React.useState<LevelResourceMeta[]>(initialResources);
  const [isUploading, setIsUploading] = React.useState<Record<string, boolean>>({});
  const [feedbackMsg, setFeedbackMsg] = React.useState<{ text: string; isError?: boolean } | null>(
    null,
  );

  // Modal State for Resource Removal
  const [removeModalState, setRemoveModalState] = React.useState<{
    isOpen: boolean;
    resourceKey: string;
    title: string;
  }>({
    isOpen: false,
    resourceKey: '',
    title: '',
  });
  const [isRemoving, setIsRemoving] = React.useState(false);

  const evidenceResource = resources.find((r) => r.resourceKey === 'EVIDENCE_PACKAGE');
  const sampleReportResource = resources.find((r) => r.resourceKey === 'SAMPLE_REPORT');

  const evidenceInputRef = React.useRef<HTMLInputElement | null>(null);
  const sampleReportInputRef = React.useRef<HTMLInputElement | null>(null);

  async function handleFileUpload(resourceKey: string, file: File) {
    try {
      setIsUploading((prev) => ({ ...prev, [resourceKey]: true }));
      setFeedbackMsg(null);

      const formData = new FormData();
      formData.append('levelNumber', levelNumber.toString());
      formData.append('resourceKey', resourceKey);
      formData.append('file', file);

      const result = await uploadOrReplaceLevelResourceAction(formData);

      if (!result.success || !result.data) {
        setFeedbackMsg({
          text: result.error || 'Failed to upload resource.',
          isError: true,
        });
        return;
      }

      const updated = result.data;
      setResources((prev) => {
        const filtered = prev.filter((r) => r.resourceKey !== resourceKey);
        return [...filtered, updated];
      });

      setFeedbackMsg({
        text: `Successfully published ${updated.title} ("${updated.originalName}").`,
      });
    } catch (err) {
      setFeedbackMsg({
        text: err instanceof Error ? err.message : 'An error occurred during file upload.',
        isError: true,
      });
    } finally {
      setIsUploading((prev) => ({ ...prev, [resourceKey]: false }));
      if (resourceKey === 'EVIDENCE_PACKAGE' && evidenceInputRef.current) {
        evidenceInputRef.current.value = '';
      }
      if (resourceKey === 'SAMPLE_REPORT' && sampleReportInputRef.current) {
        sampleReportInputRef.current.value = '';
      }
    }
  }

  function promptRemove(resourceKey: string, title: string) {
    setRemoveModalState({
      isOpen: true,
      resourceKey,
      title,
    });
  }

  async function handleConfirmRemove() {
    const { resourceKey, title } = removeModalState;
    if (!resourceKey) return;

    try {
      setIsRemoving(true);
      setFeedbackMsg(null);

      const result = await removeLevelResourceAction(levelNumber, resourceKey);

      if (!result.success) {
        setFeedbackMsg({
          text: result.error || 'Failed to remove resource.',
          isError: true,
        });
        return;
      }

      setResources((prev) => prev.filter((r) => r.resourceKey !== resourceKey));
      setFeedbackMsg({
        text: `Successfully removed ${title}. Participants will no longer be able to download this file.`,
      });
      setRemoveModalState({ isOpen: false, resourceKey: '', title: '' });
    } catch (err) {
      setFeedbackMsg({
        text: err instanceof Error ? err.message : 'Failed to remove resource.',
        isError: true,
      });
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <div className="space-y-8 font-mono">
      {/* Header */}
      <div className="border-border/80 bg-card/60 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-emerald-400 uppercase">
              <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
              <span>{vaultLabel}</span>
            </div>
            <h1 className="font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {pageTitle}
            </h1>
            <p className="text-muted-foreground font-sans text-sm">{pageDesc}</p>
          </div>
        </div>

        {feedbackMsg && (
          <div
            className={`mt-4 rounded-xl border p-3.5 text-xs ${
              feedbackMsg.isError
                ? 'border-rose-500/40 bg-rose-950/40 text-rose-300'
                : 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.15)]'
            }`}
          >
            {feedbackMsg.text}
          </div>
        )}
      </div>

      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={evidenceInputRef}
        accept=".zip,application/zip,application/x-zip-compressed"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileUpload('EVIDENCE_PACKAGE', file);
        }}
      />

      <input
        type="file"
        ref={sampleReportInputRef}
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileUpload('SAMPLE_REPORT', file);
        }}
      />

      {/* Resources Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* ========================================================================= */}
        {/* RESOURCE 1: Evidence Package (.zip)                                       */}
        {/* ========================================================================= */}
        <div className="border-border/80 bg-card/60 flex flex-col justify-between space-y-6 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
          <div className="space-y-4">
            <div className="border-border/50 flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">📦</span>
                <h2 className="text-sm font-bold text-white uppercase">Evidence Package</h2>
              </div>
              <span
                className={`rounded-md border px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                  evidenceResource?.isPublished
                    ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                    : 'border-border bg-background/60 text-muted-foreground'
                }`}
              >
                {evidenceResource?.isPublished ? 'PUBLISHED' : 'NOT PUBLISHED'}
              </span>
            </div>

            <p className="text-muted-foreground font-sans text-xs leading-relaxed">
              {evidenceDesc}
            </p>

            <div className="border-border/60 bg-background/50 space-y-2 rounded-xl border p-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-[10px] uppercase">Current File</span>
                <span className="font-bold text-cyan-300">
                  {evidenceResource?.originalName || 'None'}
                </span>
              </div>
              <div className="border-border/40 flex items-center justify-between border-t pt-2">
                <span className="text-muted-foreground text-[10px] uppercase">File Size</span>
                <span className="text-white">
                  {evidenceResource
                    ? `${(evidenceResource.fileSize / (1024 * 1024)).toFixed(2)} MB`
                    : '—'}
                </span>
              </div>
              <div className="border-border/40 flex items-center justify-between border-t pt-2">
                <span className="text-muted-foreground text-[10px] uppercase">Last Updated</span>
                <span className="text-muted-foreground text-[11px]">
                  {evidenceResource ? formatDateTime(evidenceResource.updatedAt) : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="border-border/40 border-t pt-4">
            {evidenceResource ? (
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={isUploading['EVIDENCE_PACKAGE']}
                  onClick={() => evidenceInputRef.current?.click()}
                  className="rounded-xl border border-cyan-500/50 bg-cyan-950/40 py-2.5 text-xs font-bold text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.15)] transition-all hover:bg-cyan-900/60 hover:text-white disabled:opacity-50"
                >
                  {isUploading['EVIDENCE_PACKAGE'] ? 'UPLOADING...' : 'REPLACE FILE'}
                </button>

                <button
                  type="button"
                  onClick={() => promptRemove('EVIDENCE_PACKAGE', 'Evidence Package')}
                  className="rounded-xl border border-rose-500/50 bg-rose-950/40 py-2.5 text-xs font-bold text-rose-300 transition-all hover:bg-rose-900/60 hover:text-white"
                >
                  REMOVE
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isUploading['EVIDENCE_PACKAGE']}
                onClick={() => evidenceInputRef.current?.click()}
                className="w-full rounded-xl border border-emerald-500/50 bg-emerald-950/50 py-3 text-xs font-bold text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.2)] transition-all hover:bg-emerald-900/70 hover:text-white disabled:opacity-50"
              >
                {isUploading['EVIDENCE_PACKAGE'] ? 'UPLOADING...' : 'UPLOAD EVIDENCE ZIP (.ZIP)'}
              </button>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* RESOURCE 2: Sample Report (.pdf)                                          */}
        {/* ========================================================================= */}
        <div className="border-border/80 bg-card/60 flex flex-col justify-between space-y-6 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
          <div className="space-y-4">
            <div className="border-border/50 flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">📄</span>
                <h2 className="text-sm font-bold text-white uppercase">Sample Report</h2>
              </div>
              <span
                className={`rounded-md border px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                  sampleReportResource?.isPublished
                    ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                    : 'border-border bg-background/60 text-muted-foreground'
                }`}
              >
                {sampleReportResource?.isPublished ? 'PUBLISHED' : 'NOT PUBLISHED'}
              </span>
            </div>

            <p className="text-muted-foreground font-sans text-xs leading-relaxed">
              {sampleReportDesc}
            </p>

            <div className="border-border/60 bg-background/50 space-y-2 rounded-xl border p-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-[10px] uppercase">Current File</span>
                <span className="font-bold text-cyan-300">
                  {sampleReportResource?.originalName || 'None'}
                </span>
              </div>
              <div className="border-border/40 flex items-center justify-between border-t pt-2">
                <span className="text-muted-foreground text-[10px] uppercase">File Size</span>
                <span className="text-white">
                  {sampleReportResource
                    ? `${(sampleReportResource.fileSize / (1024 * 1024)).toFixed(2)} MB`
                    : '—'}
                </span>
              </div>
              <div className="border-border/40 flex items-center justify-between border-t pt-2">
                <span className="text-muted-foreground text-[10px] uppercase">Last Updated</span>
                <span className="text-muted-foreground text-[11px]">
                  {sampleReportResource ? formatDateTime(sampleReportResource.updatedAt) : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="border-border/40 border-t pt-4">
            {sampleReportResource ? (
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={isUploading['SAMPLE_REPORT']}
                  onClick={() => sampleReportInputRef.current?.click()}
                  className="rounded-xl border border-cyan-500/50 bg-cyan-950/40 py-2.5 text-xs font-bold text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.15)] transition-all hover:bg-cyan-900/60 hover:text-white disabled:opacity-50"
                >
                  {isUploading['SAMPLE_REPORT'] ? 'UPLOADING...' : 'REPLACE FILE'}
                </button>

                <button
                  type="button"
                  onClick={() => promptRemove('SAMPLE_REPORT', 'Sample Report')}
                  className="rounded-xl border border-rose-500/50 bg-rose-950/40 py-2.5 text-xs font-bold text-rose-300 transition-all hover:bg-rose-900/60 hover:text-white"
                >
                  REMOVE
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isUploading['SAMPLE_REPORT']}
                onClick={() => sampleReportInputRef.current?.click()}
                className="w-full rounded-xl border border-emerald-500/50 bg-emerald-950/50 py-3 text-xs font-bold text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.2)] transition-all hover:bg-emerald-900/70 hover:text-white disabled:opacity-50"
              >
                {isUploading['SAMPLE_REPORT'] ? 'UPLOADING...' : 'UPLOAD SAMPLE REPORT (.PDF)'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Removal */}
      <ConfirmationModal
        isOpen={removeModalState.isOpen}
        title={`Remove ${removeModalState.title}?`}
        description="Removing this resource will permanently delete the file and remove download access for all participants immediately."
        confirmLabel="Remove Resource"
        variant="danger"
        isPending={isRemoving}
        onConfirm={handleConfirmRemove}
        onCancel={() =>
          !isRemoving && setRemoveModalState({ isOpen: false, resourceKey: '', title: '' })
        }
      />
    </div>
  );
}
