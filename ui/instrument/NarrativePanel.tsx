import MarkdownDisplay from '../shared/MarkdownDisplay';
import { getProviderColor, getProviderConfig } from '../utils/provider-helpers';
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { CopyButton } from '../shared/CopyButton';

interface NarrativePanelProps {
  narrativeText: string;
  activeMappingPid?: string;
  artifact?: any | null;
  aiTurnId?: string | null;
  rawMappingText?: string;
}

export function NarrativePanel({
  narrativeText,
  activeMappingPid,
  artifact,
  aiTurnId,
  rawMappingText,
}: NarrativePanelProps) {
  const provider = activeMappingPid ? getProviderConfig(activeMappingPid) : undefined;
  const color = activeMappingPid ? getProviderColor(activeMappingPid) : '#8b5cf6';
  const [rawOpen, setRawOpen] = useState(false);
  const [rawJson, setRawJson] = useState<string>('');
  const [rawError, setRawError] = useState<string | null>(null);
  const [showRawText, setShowRawText] = useState(false);

  const stringifyForDebug = useMemo(() => {
    return (value: any) => {
      const seen = new WeakSet();
      return JSON.stringify(
        value,
        (_key, v) => {
          if (v instanceof Map) return Object.fromEntries(v);
          if (v instanceof Set) return Array.from(v);
          if (typeof v === 'bigint') return String(v);
          if (typeof v === 'object' && v !== null) {
            if (seen.has(v)) return '[Circular]';
            seen.add(v);
          }
          return v;
        },
        2
      );
    };
  }, []);

  // Reset cached raw JSON when artifact or turn changes; rebuild if panel is open
  useEffect(() => {
    if (rawOpen && artifact) {
      try {
        setRawError(null);
        setRawJson(stringifyForDebug(artifact));
      } catch (e: any) {
        setRawError(String(e?.message || e));
        setRawJson('');
      }
    } else {
      setRawJson('');
      setRawError(null);
    }
  }, [artifact, aiTurnId, rawOpen, stringifyForDebug]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Provider badge + Raw Text toggle */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-[12px] font-medium text-text-primary">
          {provider?.name || activeMappingPid || 'Mapper'}
        </span>
        <span className="text-[11px] text-text-muted ml-1">Narrative</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className={clsx(
              'px-2.5 py-1 rounded-md border text-[10px] transition-colors',
              showRawText
                ? 'border-brand-500/40 bg-brand-500/10 text-brand-300 hover:bg-brand-500/20'
                : 'border-white/10 bg-white/5 text-text-muted hover:text-text-primary hover:bg-white/10'
            )}
            onClick={() => setShowRawText((v) => !v)}
            title={showRawText ? 'Show narrative' : "Show mapper's full raw response"}
          >
            {showRawText ? 'Narrative' : 'Raw Text'}
          </button>
        </div>
      </div>

      {/* Narrative content OR Raw mapper text */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4">
        {showRawText ? (
          <div className="prose prose-sm prose-invert max-w-none">
            {rawMappingText ? (
              <MarkdownDisplay content={rawMappingText} />
            ) : (
              <div className="text-text-muted text-sm py-4">No raw mapper text available.</div>
            )}
          </div>
        ) : narrativeText ? (
          <div className="prose prose-sm prose-invert max-w-none">
            <MarkdownDisplay content={narrativeText} />
          </div>
        ) : (
          <div className="text-text-muted text-sm py-4">
            No narrative available for this mapping.
          </div>
        )}

        <div className="mt-6 border-t border-white/10 pt-4">
          <button
            type="button"
            className={clsx(
              'w-full flex items-center justify-between px-3 py-2 rounded-lg border transition-colors',
              'border-border-subtle text-text-secondary hover:text-text-primary hover:bg-white/5'
            )}
            onClick={() => {
              const next = !rawOpen;
              setRawOpen(next);
              if (next && !rawJson && artifact) {
                try {
                  setRawError(null);
                  setRawJson(stringifyForDebug(artifact));
                } catch (e: any) {
                  setRawError(String(e?.message || e));
                  setRawJson('');
                }
              }
            }}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider">Raw Artifact</span>
            <span className="text-[10px] text-text-muted">{rawOpen ? '▲' : '▼'}</span>
          </button>

          {rawOpen && (
            <div className="mt-2 rounded-lg border border-white/10 bg-black/10 p-3">
              <div className="flex items-center gap-2 mb-2">
                <CopyButton
                  text={rawJson || ''}
                  label="Copy raw artifact JSON"
                  variant="icon"
                  disabled={!rawJson}
                />
                <button
                  type="button"
                  className="px-2 py-1 rounded-md text-[11px] border border-border-subtle text-text-muted hover:text-text-primary hover:bg-white/5 transition-colors disabled:opacity-50"
                  disabled={!rawJson}
                  onClick={() => {
                    const text = rawJson || '';
                    if (!text) return;
                    const blob = new Blob([text], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `mapping_artifact_${aiTurnId || 'turn'}.json`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 10_000);
                  }}
                >
                  Export
                </button>
              </div>
              {rawError && <div className="text-[11px] text-red-400 mb-2">{rawError}</div>}
              <pre className="text-[10px] text-text-muted font-mono whitespace-pre-wrap break-all leading-relaxed">
                {rawJson || (artifact ? '(empty)' : '(no artifact data)')}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
