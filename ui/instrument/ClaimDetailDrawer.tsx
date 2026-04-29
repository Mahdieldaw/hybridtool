import { useMemo, useEffect } from 'react';
import { m } from 'framer-motion';
import MarkdownDisplay from '../shared/MarkdownDisplay';
import { SupporterOrbs } from './SupporterOrbs';

interface ClaimDetailDrawerProps {
  claim: any;
  artifact: any;
  narrativeText: string;
  citationSourceOrder?: Record<string | number, string>;
  variant?: 'side' | 'bottom';
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onClose: () => void;
  onClaimNavigate?: (claimId: string) => void;
}

// ── Narrative excerpt extraction ──────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractNarrativeExcerpt(narrativeText: string, label: string): string {
  if (!narrativeText || !label) return '';
  const paragraphs = narrativeText.split(/\n\n+/);
  const labelLower = label.toLowerCase();
  const matching: string[] = [];
  for (const para of paragraphs) {
    if (para.toLowerCase().includes(labelLower)) {
      const highlighted = para.replace(new RegExp(`(${escapeRegex(label)})`, 'gi'), '**$1**');
      matching.push(highlighted);
    }
  }
  return matching.slice(0, 3).join('\n\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  anchor: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  branch: 'bg-green-500/20 text-green-300 border-green-500/40',
  challenger: 'bg-red-500/20 text-red-300 border-red-500/40',
  supplement: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
};

const EDGE_TYPE_STYLE: Record<string, { color: string; label: string }> = {
  supports: { color: 'text-emerald-400', label: 'supports' },
  conflicts: { color: 'text-red-400', label: 'conflicts' },
  tradeoff: { color: 'text-amber-400', label: 'tradeoff' },
  prerequisite: { color: 'text-blue-400', label: 'prerequisite' },
  dependency: { color: 'text-blue-400', label: 'dependency' },
};

// ── Main Component ────────────────────────────────────────────────────────

export function ClaimDetailDrawer({
  claim,
  artifact,
  narrativeText,
  citationSourceOrder,
  variant = 'side',
  collapsed = false,
  onToggleCollapsed,
  onClose,
  onClaimNavigate,
}: ClaimDetailDrawerProps) {
  // Keyboard: Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Connected edges
  const connectedEdges = useMemo(() => {
    const edges: any[] = artifact?.semantic?.edges ?? [];
    const claims: any[] = artifact?.semantic?.claims ?? [];
    const claimMap = new Map<string, string>();
    for (const c of claims) claimMap.set(String(c.id), String(c.label || c.id));

    const claimIdStr = String(claim.id);
    return edges
      .filter((e: any) => String(e.from) === claimIdStr || String(e.to) === claimIdStr)
      .map((e: any) => {
        const otherId = String(e.from) === claimIdStr ? String(e.to) : String(e.from);
        return {
          type: e.type,
          otherId,
          otherLabel: claimMap.get(otherId) || otherId,
          direction: String(e.from) === claimIdStr ? 'outgoing' : 'incoming',
        };
      });
  }, [claim.id, artifact]);

  // Narrative excerpt
  const narrativeExcerpt = useMemo(
    () => extractNarrativeExcerpt(narrativeText, claim.label || ''),
    [narrativeText, claim.label]
  );

  const roleClass = ROLE_COLORS[claim.role] || ROLE_COLORS.supplement;

  const containerClassName =
    variant === 'bottom'
      ? 'w-full h-full border-t border-white/10 bg-surface-raised flex flex-col overflow-hidden z-50'
      : 'absolute right-0 top-0 w-[400px] h-full border-l border-white/10 bg-surface-raised flex flex-col overflow-hidden z-50';

  return (
    <m.div
      initial={variant === 'bottom' ? { y: 96, opacity: 0 } : { x: 400, opacity: 0 }}
      animate={variant === 'bottom' ? { y: 0, opacity: 1 } : { x: 0, opacity: 1 }}
      exit={variant === 'bottom' ? { y: 96, opacity: 0 } : { x: 400, opacity: 0 }}
      transition={{ type: 'spring', damping: 26, stiffness: 300 }}
      className={containerClassName}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary truncate flex-1">{claim.label}</h3>
        <div className="flex items-center gap-2">
          {onToggleCollapsed && (
            <button
              type="button"
              className="text-text-muted hover:text-text-primary transition-colors px-2 py-1 rounded-md hover:bg-white/5 text-[11px]"
              onClick={onToggleCollapsed}
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
          <button
            type="button"
            className="text-text-muted hover:text-text-primary transition-colors p-1"
            onClick={onClose}
            title="Close (Esc)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-5">
          {/* Role + Type badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {claim.role && (
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${roleClass}`}
              >
                {claim.role}
              </span>
            )}
            {claim.type && (
              <span className="px-2 py-0.5 rounded-full text-[10px] border bg-white/5 border-white/10 text-text-muted">
                {claim.type}
              </span>
            )}
          </div>

          {/* Claim text */}
          {claim.text && (
            <p className="text-[12px] text-text-secondary leading-relaxed">{claim.text}</p>
          )}

          {/* Supporter Orbs */}
          <div>
            <h4 className="text-[11px] font-medium text-text-muted mb-2">Supported by</h4>
            <SupporterOrbs
              supporters={claim.supporters ?? []}
              citationSourceOrder={citationSourceOrder}
              size="small"
            />
          </div>

          {/* Connected Edges */}
          {connectedEdges.length > 0 && (
            <div>
              <h4 className="text-[11px] font-medium text-text-muted mb-2">
                Connected edges ({connectedEdges.length})
              </h4>
              <div className="space-y-1.5">
                {connectedEdges.map((edge, i) => {
                  const style = EDGE_TYPE_STYLE[edge.type] || {
                    color: 'text-text-muted',
                    label: edge.type,
                  };
                  return (
                    <button
                      key={i}
                      type="button"
                      className="flex items-center gap-2 text-[11px] group cursor-pointer hover:bg-white/5 rounded px-1.5 py-1 -mx-1.5 w-full text-left"
                      onClick={() => onClaimNavigate?.(edge.otherId)}
                      aria-label={`${edge.type} ${edge.direction === 'outgoing' ? 'to' : 'from'} ${edge.otherLabel}`}
                    >
                      <span className={`${style.color} font-medium w-[72px] flex-none`}>
                        {style.label}
                      </span>
                      <span className="text-text-muted">
                        {edge.direction === 'outgoing' ? '→' : '←'}
                      </span>
                      <span className="text-text-primary truncate">{edge.otherLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Narrative Excerpt */}
          <div>
            <h4 className="text-[11px] font-medium text-text-muted mb-2">Narrative excerpt</h4>
            {narrativeExcerpt ? (
              <div className="text-[12px] text-text-secondary bg-white/3 rounded-lg px-3 py-2 border border-white/5">
                <MarkdownDisplay content={narrativeExcerpt} />
              </div>
            ) : (
              <div className="text-[11px] text-text-muted italic">No matching excerpt found.</div>
            )}
          </div>
        </div>
      )}
    </m.div>
  );
}
