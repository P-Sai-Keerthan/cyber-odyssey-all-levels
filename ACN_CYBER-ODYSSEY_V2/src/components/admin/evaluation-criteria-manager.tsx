'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  getAllEvaluationCriteriaAction,
  createEvaluationCriterionAction,
  updateEvaluationCriterionAction,
  deleteEvaluationCriterionAction,
  type EvaluationCriterionDTO,
  type LevelEvaluationConfigDTO,
} from '@/lib/actions/evaluation-criteria-actions';

export function EvaluationCriteriaManager() {
  const router = useRouter();

  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<Record<number, LevelEvaluationConfigDTO>>({});
  const [selectedLevel, setSelectedLevel] = React.useState<number>(2);
  const [feedback, setFeedback] = React.useState<{ kind: 'ok' | 'err'; message: string } | null>(
    null,
  );

  // Add form state
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState('');
  const [newDescription, setNewDescription] = React.useState('');
  const [newMaxPoints, setNewMaxPoints] = React.useState<number>(250);
  const [newGuidance, setNewGuidance] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Edit state
  const [editingCriterion, setEditingCriterion] = React.useState<EvaluationCriterionDTO | null>(
    null,
  );

  const loadData = React.useCallback(async () => {
    setLoading(true);
    const res = await getAllEvaluationCriteriaAction();
    if (res.success && res.data) {
      setData(res.data);
    } else {
      setFeedback({ kind: 'err', message: res.error || 'Failed to load criteria.' });
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  const currentLevelConfig = data[selectedLevel] || {
    levelNumber: selectedLevel,
    maxPossibleScore: 0,
    criteria: [],
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      setFeedback({ kind: 'err', message: 'Criterion title is required.' });
      return;
    }
    if (newMaxPoints <= 0) {
      setFeedback({ kind: 'err', message: 'Maximum points must be a positive integer.' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    const res = await createEvaluationCriterionAction({
      levelNumber: selectedLevel,
      title: newTitle.trim(),
      description: newDescription.trim() || undefined,
      maxPoints: newMaxPoints,
      guidance: newGuidance.trim() || undefined,
    });

    if (res.success) {
      setFeedback({
        kind: 'ok',
        message: `Created criterion "${res.data?.title}" (${res.data?.maxPoints} pts).`,
      });
      setShowAddForm(false);
      setNewTitle('');
      setNewDescription('');
      setNewMaxPoints(250);
      setNewGuidance('');
      await loadData();
      router.refresh();
    } else {
      setFeedback({ kind: 'err', message: res.error || 'Failed to create criterion.' });
    }
    setIsSubmitting(false);
  };

  const handleToggleActive = async (criterion: EvaluationCriterionDTO) => {
    setFeedback(null);
    const res = await updateEvaluationCriterionAction(criterion.id, {
      isActive: !criterion.isActive,
    });
    if (res.success) {
      setFeedback({
        kind: 'ok',
        message: `Criterion "${criterion.title}" is now ${!criterion.isActive ? 'ACTIVE' : 'INACTIVE'}.`,
      });
      await loadData();
      router.refresh();
    } else {
      setFeedback({ kind: 'err', message: res.error || 'Failed to update criterion.' });
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCriterion) return;

    setIsSubmitting(true);
    setFeedback(null);

    const res = await updateEvaluationCriterionAction(editingCriterion.id, {
      title: editingCriterion.title,
      description: editingCriterion.description || undefined,
      maxPoints: editingCriterion.maxPoints,
      guidance: editingCriterion.guidance || undefined,
      sortOrder: editingCriterion.sortOrder,
      isActive: editingCriterion.isActive,
    });

    if (res.success) {
      setFeedback({ kind: 'ok', message: `Updated criterion "${editingCriterion.title}".` });
      setEditingCriterion(null);
      await loadData();
      router.refresh();
    } else {
      setFeedback({ kind: 'err', message: res.error || 'Failed to update criterion.' });
    }
    setIsSubmitting(false);
  };

  const handleDelete = async (criterion: EvaluationCriterionDTO) => {
    if (!window.confirm(`Are you sure you want to remove criterion "${criterion.title}"?`)) {
      return;
    }

    setFeedback(null);
    const res = await deleteEvaluationCriterionAction(criterion.id);
    if (res.success) {
      setFeedback({
        kind: 'ok',
        message: res.data?.deleted
          ? `Criterion "${criterion.title}" permanently deleted.`
          : `Criterion "${criterion.title}" deactivated (preserved for historical scores).`,
      });
      await loadData();
      router.refresh();
    } else {
      setFeedback({ kind: 'err', message: res.error || 'Failed to delete criterion.' });
    }
  };

  return (
    <div className="space-y-6 font-mono">
      {/* Top Controls & Level Switcher */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedLevel(2)}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              selectedLevel === 2
                ? 'border border-cyan-500/50 bg-cyan-950/60 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                : 'border-border/60 bg-card/40 text-muted-foreground border hover:text-white'
            }`}
          >
            LEVEL 2 (FORENSICS)
          </button>
          <button
            type="button"
            onClick={() => setSelectedLevel(3)}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              selectedLevel === 3
                ? 'border border-purple-500/50 bg-purple-950/60 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.2)]'
                : 'border-border/60 bg-card/40 text-muted-foreground border hover:text-white'
            }`}
          >
            LEVEL 3 (INCIDENT REPORT)
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-card/60 rounded-xl border border-cyan-500/30 px-4 py-2 text-right backdrop-blur-xl">
            <span className="text-muted-foreground text-[10px] uppercase">
              LEVEL {selectedLevel} TOTAL MAX
            </span>
            <div className="text-base font-black text-cyan-300">
              {currentLevelConfig.maxPossibleScore} PTS
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="rounded-xl border border-cyan-400 bg-cyan-500 px-4 py-2 text-xs font-black text-black shadow-[0_0_15px_rgba(34,211,238,0.3)] transition-all hover:bg-cyan-400"
          >
            {showAddForm ? '✕ CANCEL' : '+ ADD CRITERION'}
          </button>
        </div>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div
          className={`rounded-xl border p-4 text-xs font-bold ${
            feedback.kind === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
              : 'border-rose-500/40 bg-rose-950/40 text-rose-300'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Add Criterion Form */}
      {showAddForm && (
        <form
          onSubmit={handleCreate}
          className="border-border/80 bg-card/70 space-y-4 rounded-2xl border p-6 backdrop-blur-xl"
        >
          <div className="border-border/60 border-b pb-3">
            <h3 className="text-sm font-bold text-cyan-300 uppercase">
              NEW EVALUATION CRITERION · LEVEL {selectedLevel}
            </h3>
            <p className="text-muted-foreground font-sans text-xs">
              Create a scoring criterion. The level max score will automatically adjust to the sum
              of active criteria.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
            <div className="space-y-1 sm:col-span-8">
              <label htmlFor="crit-title-new" className="text-muted-foreground text-xs uppercase">
                Criterion Title *
              </label>
              <input
                id="crit-title-new"
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Memory Artifact Reconstruction"
                className="border-border/80 bg-background/80 text-foreground w-full rounded-xl border px-3 py-2 text-xs focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1 sm:col-span-4">
              <label htmlFor="crit-pts-new" className="text-muted-foreground text-xs uppercase">
                Max Points *
              </label>
              <input
                id="crit-pts-new"
                type="number"
                min={1}
                required
                value={newMaxPoints}
                onChange={(e) => setNewMaxPoints(parseInt(e.target.value, 10) || 0)}
                className="border-border/80 bg-background/80 text-foreground w-full rounded-xl border px-3 py-2 text-right text-xs font-bold focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1 sm:col-span-12">
              <label htmlFor="crit-desc-new" className="text-muted-foreground text-xs uppercase">
                Description
              </label>
              <input
                id="crit-desc-new"
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Summary of what is being judged in this criterion"
                className="border-border/80 bg-background/80 text-foreground w-full rounded-xl border px-3 py-2 text-xs focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1 sm:col-span-12">
              <label htmlFor="crit-guide-new" className="text-muted-foreground text-xs uppercase">
                Evaluator Guidance / Benchmark Notes
              </label>
              <textarea
                id="crit-guide-new"
                rows={2}
                value={newGuidance}
                onChange={(e) => setNewGuidance(e.target.value)}
                placeholder="Instructions shown directly to evaluators to ensure uniform scoring..."
                className="border-border/80 bg-background/80 text-foreground w-full rounded-xl border p-3 text-xs focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="border-border bg-card/60 text-muted-foreground rounded-xl border px-4 py-2 text-xs font-bold hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl border border-cyan-400 bg-cyan-500 px-5 py-2 text-xs font-black text-black shadow-[0_0_12px_rgba(34,211,238,0.3)] hover:bg-cyan-400 disabled:opacity-50"
            >
              {isSubmitting ? 'SAVING...' : 'CREATE CRITERION'}
            </button>
          </div>
        </form>
      )}

      {/* Edit Modal / Form */}
      {editingCriterion && (
        <form
          onSubmit={handleUpdate}
          className="border-border/80 bg-card/90 space-y-4 rounded-2xl border p-6 backdrop-blur-2xl"
        >
          <div className="border-border/60 border-b pb-3">
            <h3 className="text-sm font-bold text-amber-300 uppercase">
              EDIT CRITERION: {editingCriterion.title}
            </h3>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
            <div className="space-y-1 sm:col-span-8">
              <label htmlFor="crit-title-edit" className="text-muted-foreground text-xs uppercase">
                Criterion Title
              </label>
              <input
                id="crit-title-edit"
                type="text"
                required
                value={editingCriterion.title}
                onChange={(e) =>
                  setEditingCriterion({ ...editingCriterion, title: e.target.value })
                }
                className="border-border/80 bg-background/80 text-foreground w-full rounded-xl border px-3 py-2 text-xs focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1 sm:col-span-4">
              <label htmlFor="crit-pts-edit" className="text-muted-foreground text-xs uppercase">
                Max Points
              </label>
              <input
                id="crit-pts-edit"
                type="number"
                min={1}
                required
                value={editingCriterion.maxPoints}
                onChange={(e) =>
                  setEditingCriterion({
                    ...editingCriterion,
                    maxPoints: parseInt(e.target.value, 10) || 0,
                  })
                }
                className="border-border/80 bg-background/80 text-foreground w-full rounded-xl border px-3 py-2 text-right text-xs font-bold focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1 sm:col-span-12">
              <label htmlFor="crit-desc-edit" className="text-muted-foreground text-xs uppercase">
                Description
              </label>
              <input
                id="crit-desc-edit"
                type="text"
                value={editingCriterion.description || ''}
                onChange={(e) =>
                  setEditingCriterion({ ...editingCriterion, description: e.target.value })
                }
                className="border-border/80 bg-background/80 text-foreground w-full rounded-xl border px-3 py-2 text-xs focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1 sm:col-span-12">
              <label htmlFor="crit-guide-edit" className="text-muted-foreground text-xs uppercase">
                Guidance
              </label>
              <textarea
                id="crit-guide-edit"
                rows={2}
                value={editingCriterion.guidance || ''}
                onChange={(e) =>
                  setEditingCriterion({ ...editingCriterion, guidance: e.target.value })
                }
                className="border-border/80 bg-background/80 text-foreground w-full rounded-xl border p-3 text-xs focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setEditingCriterion(null)}
              className="border-border bg-card/60 text-muted-foreground rounded-xl border px-4 py-2 text-xs font-bold hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl border border-amber-400 bg-amber-500 px-5 py-2 text-xs font-black text-black hover:bg-amber-400 disabled:opacity-50"
            >
              {isSubmitting ? 'SAVING...' : 'SAVE CHANGES'}
            </button>
          </div>
        </form>
      )}

      {/* Criteria List */}
      <div className="space-y-3">
        {loading ? (
          <div className="border-border/60 bg-card/40 text-muted-foreground rounded-2xl border p-8 text-center text-xs">
            Loading criteria configuration...
          </div>
        ) : currentLevelConfig.criteria.length === 0 ? (
          <div className="border-border/60 bg-card/40 text-muted-foreground rounded-2xl border p-8 text-center text-xs">
            No criteria configured for Level {selectedLevel}. Click &quot;+ ADD CRITERION&quot;
            above to establish the rubric.
          </div>
        ) : (
          currentLevelConfig.criteria.map((crit, idx) => (
            <div
              key={crit.id}
              className={`border-border/80 bg-card/60 flex flex-col gap-3 rounded-2xl border p-4 backdrop-blur-xl transition-all sm:flex-row sm:items-center sm:justify-between ${
                !crit.isActive ? 'opacity-60' : ''
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="rounded border border-cyan-500/40 bg-cyan-950/40 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                    #{idx + 1}
                  </span>
                  <h4 className="text-sm font-bold text-white">{crit.title}</h4>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      crit.isActive
                        ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                        : 'border border-zinc-500/40 bg-zinc-950/40 text-zinc-400'
                    }`}
                  >
                    {crit.isActive ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                </div>

                {crit.description && (
                  <p className="text-muted-foreground font-sans text-xs">{crit.description}</p>
                )}

                {crit.guidance && (
                  <div className="text-muted-foreground text-[11px]">
                    <span className="text-cyan-400">Guidance: </span>
                    {crit.guidance}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span className="rounded-xl border border-cyan-500/40 bg-cyan-950/40 px-3 py-1.5 text-xs font-black text-cyan-300">
                  {crit.maxPoints} PTS
                </span>

                <button
                  type="button"
                  onClick={() => handleToggleActive(crit)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-all ${
                    crit.isActive
                      ? 'border-zinc-600 bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800'
                      : 'border-emerald-500/50 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/60'
                  }`}
                >
                  {crit.isActive ? 'Deactivate' : 'Activate'}
                </button>

                <button
                  type="button"
                  onClick={() => setEditingCriterion(crit)}
                  className="rounded-lg border border-cyan-500/40 bg-cyan-950/40 px-3 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-900/60"
                >
                  Edit
                </button>

                <button
                  type="button"
                  onClick={() => handleDelete(crit)}
                  className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-900/60"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
