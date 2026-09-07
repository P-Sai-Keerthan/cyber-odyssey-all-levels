'use client';

import * as React from 'react';
import {
  createAnnouncementAction,
  deleteAnnouncementAction,
  type AdminAnnouncementItem,
} from '@/lib/actions/admin-actions';
import { ConfirmationModal } from '@/components/creator/confirmation-modal';
import { formatDateTime } from '@/lib/utils/date-formatter';

export interface AnnouncementsClientProps {
  initialAnnouncements: AdminAnnouncementItem[];
}

export function AnnouncementsClient({ initialAnnouncements }: AnnouncementsClientProps) {
  const [announcements, setAnnouncements] =
    React.useState<AdminAnnouncementItem[]>(initialAnnouncements);

  // Form State
  const [title, setTitle] = React.useState('');
  const [content, setContent] = React.useState('');
  const [category, setCategory] = React.useState('GENERAL');
  const [priority, setPriority] = React.useState('NORMAL');
  const [targetAudience, setTargetAudience] = React.useState('ALL');
  const [levelNumber, setLevelNumber] = React.useState<number | ''>('');
  const [publishImmediately, setPublishImmediately] = React.useState(true);

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [feedbackMsg, setFeedbackMsg] = React.useState<{ text: string; isError?: boolean } | null>(
    null,
  );

  // Modal State for Delete
  const [deleteTargetId, setDeleteTargetId] = React.useState<string | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setFeedbackMsg({ text: 'Title and content are required.', isError: true });
      return;
    }

    try {
      setIsSubmitting(true);
      setFeedbackMsg(null);

      const result = await createAnnouncementAction({
        title,
        content,
        category,
        priority,
        targetAudience,
        levelNumber: levelNumber === '' ? null : Number(levelNumber),
        publishImmediately,
      });

      if (!result.success) {
        setFeedbackMsg({ text: result.error || 'Failed to create announcement.', isError: true });
        return;
      }

      // Add to local state
      const newAnnouncement: AdminAnnouncementItem = {
        id: result.data!.id,
        title: title.trim(),
        content: content.trim(),
        category,
        priority,
        targetAudience,
        levelNumber: levelNumber === '' ? null : Number(levelNumber),
        createdBy: 'You',
        published: publishImmediately,
        publishedAt: publishImmediately ? new Date().toISOString() : null,
        createdAt: new Date().toISOString(),
        notificationCount: 0,
      };

      setAnnouncements((prev) => [newAnnouncement, ...prev]);
      setTitle('');
      setContent('');
      setFeedbackMsg({ text: 'Announcement published successfully!' });
    } catch (err) {
      setFeedbackMsg({
        text: err instanceof Error ? err.message : 'Failed to publish announcement.',
        isError: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTargetId) return;

    try {
      setIsDeleting(true);
      const result = await deleteAnnouncementAction(deleteTargetId);
      if (result.success) {
        setAnnouncements((prev) => prev.filter((a) => a.id !== deleteTargetId));
        setDeleteTargetId(null);
      }
    } catch {
      // Handled
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-8 font-mono">
      {/* Header */}
      <div className="border-border/80 bg-card/60 rounded-2xl border p-6 shadow-2xl backdrop-blur-md">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
            <span className="size-2 rounded-full bg-cyan-400" />
            <span>DISPATCH DESK // BROADCAST CENTER</span>
          </div>
          <h1 className="font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Announcements & Notifications
          </h1>
          <p className="text-muted-foreground font-sans text-sm">
            Publish official event communications, level directives, and marshal notices to targeted
            audience segments.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Form Column (5 cols) */}
        <div className="space-y-6 lg:col-span-5">
          <form
            onSubmit={handleCreate}
            className="border-border/80 bg-card/60 space-y-4 rounded-2xl border p-6 shadow-xl backdrop-blur-md"
          >
            <h2 className="border-border/50 border-b pb-2 text-xs font-bold tracking-wider text-emerald-400 uppercase">
              New Operations Broadcast
            </h2>

            {feedbackMsg && (
              <div
                className={`rounded-xl border p-3 text-xs ${
                  feedbackMsg.isError
                    ? 'border-rose-500/40 bg-rose-950/40 text-rose-300'
                    : 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                }`}
              >
                {feedbackMsg.text}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-muted-foreground block text-[10px] font-semibold uppercase">
                Broadcast Title
              </label>
              <input
                type="text"
                required
                placeholder="e.g. LEVEL 2 INVESTIGATION NOW LIVE"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="border-border/80 bg-background/60 placeholder:text-muted-foreground w-full rounded-xl border px-3.5 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-muted-foreground block text-[10px] font-semibold uppercase">
                Message Content
              </label>
              <textarea
                required
                rows={4}
                placeholder="Enter detailed broadcast instructions..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="border-border/80 bg-background/60 placeholder:text-muted-foreground w-full rounded-xl border px-3.5 py-2 font-sans text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-muted-foreground block text-[10px] font-semibold uppercase">
                  Target Audience
                </label>
                <select
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  className="border-border/80 bg-background/60 w-full rounded-xl border px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="ALL">ALL USERS</option>
                  <option value="PARTICIPANTS">PARTICIPANTS ONLY</option>
                  <option value="EVALUATORS">EVALUATORS ONLY</option>
                  <option value="ADMINS">ADMINS ONLY</option>
                  <option value="LEVEL_1">LEVEL 1 PARTICIPANTS</option>
                  <option value="LEVEL_2">LEVEL 2 PARTICIPANTS</option>
                  <option value="LEVEL_3">LEVEL 3 PARTICIPANTS</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-muted-foreground block text-[10px] font-semibold uppercase">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="border-border/80 bg-background/60 w-full rounded-xl border px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="NORMAL">NORMAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="URGENT">URGENT</option>
                  <option value="LOW">LOW</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-muted-foreground block text-[10px] font-semibold uppercase">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="border-border/80 bg-background/60 w-full rounded-xl border px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="GENERAL">GENERAL</option>
                  <option value="MISSION">MISSION</option>
                  <option value="SYSTEM">SYSTEM</option>
                  <option value="URGENT">URGENT</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-muted-foreground block text-[10px] font-semibold uppercase">
                  Level Association
                </label>
                <select
                  value={levelNumber}
                  onChange={(e) =>
                    setLevelNumber(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  className="border-border/80 bg-background/60 w-full rounded-xl border px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">None (Global)</option>
                  <option value="1">Level 1</option>
                  <option value="2">Level 2</option>
                  <option value="3">Level 3</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="publishImmediately"
                checked={publishImmediately}
                onChange={(e) => setPublishImmediately(e.target.checked)}
                className="border-border bg-background/60 size-4 rounded text-emerald-500"
              />
              <label
                htmlFor="publishImmediately"
                className="text-muted-foreground text-xs font-semibold"
              >
                Dispatch notifications immediately upon publish
              </label>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl border border-emerald-500/50 bg-emerald-950/60 py-2.5 text-xs font-bold text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.2)] transition-all hover:bg-emerald-900/70 hover:text-white disabled:opacity-50"
            >
              {isSubmitting ? 'DISPATCHING...' : 'DISPATCH BROADCAST →'}
            </button>
          </form>
        </div>

        {/* Broadcast Feed Column (7 cols) */}
        <div className="space-y-4 lg:col-span-7">
          <div className="border-border/50 flex items-center justify-between border-b pb-2">
            <h2 className="text-xs font-bold tracking-wider text-cyan-400 uppercase">
              Published Broadcasts ({announcements.length})
            </h2>
          </div>

          {announcements.length === 0 ? (
            <div className="border-border/60 bg-card/40 text-muted-foreground rounded-2xl border p-12 text-center text-xs">
              No broadcasts currently in database.
            </div>
          ) : (
            <div className="space-y-4">
              {announcements.map((a) => (
                <div
                  key={a.id}
                  className="border-border/80 bg-card/60 space-y-3 rounded-2xl border p-5 shadow-xl backdrop-blur-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-white">{a.title}</span>
                        <span className="rounded border border-cyan-500/30 bg-cyan-950/60 px-2 py-0.5 text-[9px] font-bold text-cyan-300">
                          {a.targetAudience}
                        </span>
                        <span className="bg-background/60 border-border text-muted-foreground rounded border px-2 py-0.5 text-[9px] font-bold">
                          {a.priority}
                        </span>
                      </div>
                      <div className="text-muted-foreground text-[10px]">
                        Dispatched by {a.createdBy || 'Operations'} • {formatDateTime(a.createdAt)}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setDeleteTargetId(a.id)}
                      className="shrink-0 rounded-lg border border-rose-500/30 bg-rose-950/30 px-2.5 py-1 text-[10px] font-bold text-rose-300 transition-all hover:bg-rose-900/50 hover:text-white"
                    >
                      DELETE
                    </button>
                  </div>

                  <p className="text-muted-foreground font-sans text-xs leading-relaxed">
                    {a.content}
                  </p>

                  <div className="text-muted-foreground border-border/40 flex items-center justify-between border-t pt-2 text-[10px]">
                    <span>Category: {a.category}</span>
                    <span>Notifications Delivered: {a.notificationCount}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={Boolean(deleteTargetId)}
        title="Delete Broadcast?"
        description="Are you sure you want to delete this announcement? It will be removed from all participant and evaluator feeds."
        confirmLabel="Delete Announcement"
        variant="danger"
        isPending={isDeleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => !isDeleting && setDeleteTargetId(null)}
      />
    </div>
  );
}
