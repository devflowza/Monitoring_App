import { type ReactNode } from 'react';

/**
 * Minimal, dependency-free, XSS-safe Markdown renderer for report narratives.
 * Handles headings, bullet/numbered lists, blockquotes, bold, and inline code —
 * enough for Opus-generated report markdown — by emitting React elements (never
 * dangerouslySetInnerHTML, so model output can't inject markup).
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  // Split on **bold** and `code`, keeping delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={`${keyPrefix}-${i}`}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={`${keyPrefix}-${i}`} className="rounded bg-edge px-1 py-0.5 text-[0.85em]">{p.slice(1, -1)}</code>;
    return <span key={`${keyPrefix}-${i}`}>{p}</span>;
  });
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={`li-${key}-${i}`} className="ml-5 list-disc text-slate-300">{inline(it, `li-${key}-${i}`)}</li>);
    out.push(list.ordered
      ? <ol key={`ol-${key++}`} className="mb-3 ml-1 list-decimal space-y-1">{items}</ol>
      : <ul key={`ul-${key++}`} className="mb-3 ml-1 space-y-1">{items}</ul>);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushList(); continue; }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushList();
      const level = h[1].length;
      const cls = level <= 1 ? 'mt-1 mb-2 text-xl font-bold text-slate-100'
        : level === 2 ? 'mt-3 mb-2 text-lg font-semibold text-slate-100'
        : 'mt-2 mb-1 text-sm font-semibold uppercase tracking-wide text-slate-300';
      out.push(<div key={`h-${key++}`} className={cls}>{inline(h[2], `h-${key}`)}</div>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushList();
      out.push(<blockquote key={`bq-${key++}`} className="mb-3 border-l-2 border-amber-500/50 bg-amber-500/5 px-3 py-1 text-sm text-amber-200">{inline(line.replace(/^>\s?/, ''), `bq-${key}`)}</blockquote>);
      continue;
    }
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ol || ul) {
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((ol ? ol[1] : ul![1]));
      continue;
    }
    flushList();
    out.push(<p key={`p-${key++}`} className="mb-3 text-sm leading-relaxed text-slate-300">{inline(line, `p-${key}`)}</p>);
  }
  flushList();
  return <div>{out}</div>;
}
