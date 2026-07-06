/** Shared loading / error presentation for data views (the E4 tri-state). */

export function LoadingPanel({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="animate-pulse rounded-xl border border-edge bg-panel p-6 text-sm text-slate-500">
      {label}
    </div>
  );
}

export function ErrorPanel({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-sm text-red-200">
      <div className="font-semibold">This query failed — this is not an empty dataset.</div>
      <div className="mt-1 break-words text-xs text-red-300/80">{error}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded border border-red-500/40 px-3 py-1 text-xs text-red-100 hover:bg-red-500/20"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * Renders loading/error states and otherwise the children. Empty-dataset copy is
 * left to the caller (it varies per page), so this only guards the two states
 * that were previously invisible.
 */
export function QueryBoundary({
  loading, error, onRetry, children,
}: {
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  if (error) return <ErrorPanel error={error} onRetry={onRetry} />;
  if (loading) return <LoadingPanel />;
  return <>{children}</>;
}
