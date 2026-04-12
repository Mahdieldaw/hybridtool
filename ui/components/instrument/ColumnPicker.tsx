import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import type { ColumnDef } from './columnRegistry';
import { compileExpression, validateExpression } from './expressionEngine';
import type { EvidenceRow } from '../../hooks/useEvidenceRows';

// ============================================================================
// CATEGORY LABELS
// ============================================================================

const CATEGORY_LABELS: Record<string, string> = {
  identity: 'Identity',
  geometry: 'Geometry',
  continuous: 'Continuous Field',
  mixed: 'Mixed Provenance',
  blast: 'Blast Surface',
  metadata: 'Metadata',
  computed: 'Computed',
};

const CATEGORY_ORDER = [
  'identity',
  'geometry',
  'continuous',
  'mixed',
  'blast',
  'metadata',
  'computed',
];

// ============================================================================
// EXPRESSION INPUT
// ============================================================================

function ExpressionInput({
  allColumnIds,
  onAdd,
}: {
  allColumnIds: string[];
  onAdd: (col: ColumnDef) => void;
}) {
  const [expr, setExpr] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const handleExprChange = useCallback(
    (val: string) => {
      setExpr(val);
      setError(null);

      // Autocomplete: find word at cursor
      const words = val.split(/[\s+\-*/()%,?:<>!=&|]+/);
      const lastWord = words[words.length - 1];
      if (lastWord.length >= 1) {
        const matching = allColumnIds.filter(
          (id) => id.toLowerCase().startsWith(lastWord.toLowerCase()) && id !== lastWord
        );
        setSuggestions(matching.slice(0, 6));
      } else {
        setSuggestions([]);
      }
    },
    [allColumnIds]
  );

  const applySuggestion = useCallback(
    (suggestion: string) => {
      // Replace last partial word with suggestion
      const parts = expr.split(/(?=[\s+\-*/()%,?:<>!=&|])|(?<=[\s+\-*/()%,?:<>!=&|])/);
      // Find the last identifier-like token and replace it
      let i = parts.length - 1;
      while (i >= 0 && /^[a-zA-Z0-9_$]+$/.test(parts[i])) i--;
      const newExpr = parts.slice(0, i + 1).join('') + suggestion;
      setExpr(newExpr);
      setSuggestions([]);
    },
    [expr]
  );

  const handleAdd = useCallback(() => {
    const trimmed = expr.trim();
    const trimLabel = label.trim();
    if (!trimmed || !trimLabel) {
      setError('Expression and label are required');
      return;
    }

    const validationError = validateExpression(trimmed, allColumnIds);
    if (validationError) {
      setError(validationError);
      return;
    }

    const compiled = compileExpression(trimmed, allColumnIds);
    if (!compiled) {
      setError('Failed to compile expression');
      return;
    }

    const newCol: ColumnDef = {
      id: `computed_${trimLabel.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}`,
      label: trimLabel,
      accessor: (row: EvidenceRow) => compiled.evaluate(row),
      type: 'number',
      format: (v: any) => (v == null ? '—' : typeof v === 'number' ? v.toFixed(3) : String(v)),
      sortable: true,
      groupable: false,
      description: `Computed: ${trimmed}`,
      source: 'computed',
      category: 'metadata', // will be overridden to 'computed' in display
    };

    onAdd(newCol);
    setExpr('');
    setLabel('');
    setError(null);
    setSuggestions([]);
  }, [expr, label, allColumnIds, onAdd]);

  return (
    <div className="border-t border-white/10 pt-3 mt-3 space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        Add Computed Column
      </div>
      <div className="space-y-1.5 relative">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Column name"
          className="w-full bg-black/20 border border-white/10 rounded-md px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-500/50"
        />
        <div className="relative">
          <input
            type="text"
            value={expr}
            onChange={(e) => handleExprChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') setSuggestions([]);
            }}
            placeholder="e.g. sim_claim - sim_query"
            className={clsx(
              'w-full bg-black/20 border rounded-md px-2 py-1 text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none',
              error
                ? 'border-rose-500/50 focus:border-rose-500'
                : 'border-white/10 focus:border-brand-500/50'
            )}
          />
          {suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-50 mt-0.5 bg-surface border border-border-subtle rounded-lg shadow-elevated overflow-hidden">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="w-full text-left px-2 py-1 text-xs font-mono text-text-secondary hover:bg-white/10 transition-colors"
                  onClick={() => applySuggestion(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        {error && <div className="text-[11px] text-rose-400">{error}</div>}
        <div className="text-[10px] text-text-muted leading-relaxed">
          Columns: {allColumnIds.slice(0, 8).join(', ')}
          {allColumnIds.length > 8 ? '…' : ''}
        </div>
        <button
          type="button"
          onClick={handleAdd}
          className="w-full py-1 rounded-md bg-brand-500/20 border border-brand-500/40 text-brand-400 text-xs hover:bg-brand-500/30 transition-colors"
        >
          + Add Column
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// COLUMN PICKER
// ============================================================================

export interface ColumnPickerProps {
  allColumns: ColumnDef[];
  visibleColumnIds: string[];
  defaultColumnIds: string[]; // used by parent to pass to onReset externally
  onToggle: (columnId: string) => void;
  onAddComputed: (col: ColumnDef) => void;
  onReset: () => void;
}

export function ColumnPicker({
  allColumns,
  visibleColumnIds,
  defaultColumnIds: _defaultColumnIds,
  onToggle,
  onAddComputed,
  onReset,
}: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        popRef.current &&
        !popRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Group columns by category
  const grouped = useMemo(() => {
    const map = new Map<string, ColumnDef[]>();
    for (const col of allColumns) {
      const cat = col.source === 'computed' ? 'computed' : col.category;
      const arr = map.get(cat) ?? [];
      arr.push(col);
      map.set(cat, arr);
    }
    return map;
  }, [allColumns]);

  const visibleSet = new Set(visibleColumnIds);
  const allColumnIds = useMemo(() => allColumns.map((c) => c.id), [allColumns]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'px-2.5 py-1.5 rounded-lg text-[10px] border transition-colors whitespace-nowrap',
          open
            ? 'bg-brand-500/20 border-brand-500 text-text-primary'
            : 'bg-black/20 border-white/10 text-text-muted hover:text-text-primary hover:border-white/20'
        )}
      >
        + Columns
      </button>

      {open && (
        <div
          ref={popRef}
          className="absolute top-full right-0 mt-1 z-50 w-64 max-h-[480px] bg-surface border border-border-subtle rounded-xl shadow-elevated overflow-y-auto custom-scrollbar"
        >
          <div className="p-3 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Columns
              </span>
              <button
                type="button"
                onClick={onReset}
                className="text-[10px] text-text-muted hover:text-text-primary transition-colors"
              >
                Reset
              </button>
            </div>

            {/* Column groups */}
            {CATEGORY_ORDER.map((cat) => {
              const cols = grouped.get(cat);
              if (!cols || cols.length === 0) return null;
              return (
                <div key={cat} className="space-y-1">
                  <div className="text-[9px] uppercase tracking-wider text-text-muted font-semibold px-0.5">
                    {CATEGORY_LABELS[cat] ?? cat}
                  </div>
                  {cols.map((col) => (
                    <label
                      key={col.id}
                      className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-white/5 cursor-pointer group"
                      title={col.description}
                    >
                      <input
                        type="checkbox"
                        checked={visibleSet.has(col.id)}
                        onChange={() => onToggle(col.id)}
                        className="w-3 h-3 accent-brand-500 cursor-pointer"
                      />
                      <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors font-mono">
                        {col.label}
                      </span>
                      {col.source === 'computed' && (
                        <span className="ml-auto text-[9px] text-brand-400 opacity-70">fx</span>
                      )}
                    </label>
                  ))}
                </div>
              );
            })}

            {/* Expression input */}
            <ExpressionInput
              allColumnIds={allColumnIds}
              onAdd={(col) => {
                onAddComputed(col);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
