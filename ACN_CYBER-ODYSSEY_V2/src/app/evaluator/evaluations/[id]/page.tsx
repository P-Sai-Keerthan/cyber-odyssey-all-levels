import { getEvaluatorSubmissionDetailsAction } from '@/lib/actions/evaluator-actions';
import { EvaluationPanel } from '@/components/evaluator/evaluation-panel';
import Link from 'next/link';

interface EvaluationPageProps {
  params: Promise<{ id: string }>;
}

export default async function EvaluatorSubmissionDetailPage(props: EvaluationPageProps) {
  const { id } = await props.params;

  const result = await getEvaluatorSubmissionDetailsAction(id);

  if (!result.success || !result.data) {
    return (
      <div className="border-border/80 bg-card/60 flex flex-col items-center justify-center rounded-2xl border p-12 text-center backdrop-blur-xl">
        <span className="font-mono text-sm font-bold text-rose-400">
          SUBMISSION NOT FOUND OR INACCESSIBLE
        </span>
        <p className="text-muted-foreground mt-2 font-mono text-xs">
          {result.error || 'The requested forensic submission deliverable could not be retrieved.'}
        </p>
        <Link
          href="/evaluator/submissions"
          className="mt-4 rounded-xl border border-cyan-500/50 bg-cyan-950/40 px-4 py-2 font-mono text-xs font-bold text-cyan-300 hover:bg-cyan-900/60"
        >
          &larr; Return to Submissions Terminal
        </Link>
      </div>
    );
  }

  return <EvaluationPanel submission={result.data} />;
}
