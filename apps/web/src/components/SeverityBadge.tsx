import type { Severity } from '../lib/types';

const STYLES: Record<Severity, string> = {
  critical: 'bg-red-500/20 text-red-300 border-red-500/40',
  high: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  medium: 'bg-yellow-500/20 text-yellow-200 border-yellow-500/40',
  low: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  info: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold uppercase ${STYLES[severity] ?? STYLES.info}`}>
      {severity}
    </span>
  );
}
