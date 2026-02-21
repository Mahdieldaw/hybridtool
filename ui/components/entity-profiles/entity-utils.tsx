import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";

export type SummaryCard = {
  label: string;
  value: ReactNode;
  emphasis?: "good" | "warn" | "bad" | "neutral";
};

export type Column<Row> = {
  key: string;
  header: string;
  level?: 'L1' | 'L2' | 'H';
  className?: string;
  cell: (row: Row) => ReactNode;
  sortValue?: (row: Row) => string | number | null;
};

export type TableSpec<Row> = {
  title: string;
  columns: Array<Column<Row>>;
  rows: Row[];
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
  emptyMessage?: string;
};

export function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function safeNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function safeStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export function safeArr<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function formatPct(v: number | null, digits = 0) {
  if (v == null) return "—";
  return `${(clamp01(v) * 100).toFixed(digits)}%`;
}

export function formatNum(v: number | null, digits = 2) {
  if (v == null) return "—";
  const d = digits < 0 ? 0 : digits;
  return v.toFixed(d);
}

export function formatInt(v: number | null) {
  if (v == null) return "—";
  return Math.round(v).toLocaleString();
}

export function badgeClass(emphasis: SummaryCard["emphasis"]) {
  if (emphasis === "good") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (emphasis === "warn") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (emphasis === "bad") return "bg-red-500/15 text-red-300 border-red-500/30";
  return "bg-white/5 text-text-secondary border-border-subtle";
}

export function SummaryCardsRow({ cards }: { cards: SummaryCard[] }) {
  if (!cards || cards.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto custom-scrollbar py-1">
      {cards.map((c, i) => (
        <div
          key={`${c.label}-${i}`}
          className={clsx(
            "flex-none rounded-lg border px-3 py-2 min-w-[150px]",
            badgeClass(c.emphasis || "neutral")
          )}
        >
          <div className="text-[10px] uppercase tracking-wider font-semibold opacity-90">{c.label}</div>
          <div className="text-sm font-semibold text-text-primary mt-0.5 truncate">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

export function compareNullable(a: string | number | null, b: string | number | null) {
  const aNil = a == null || a === "";
  const bNil = b == null || b === "";
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function DataTable<Row extends { id?: string }>({
  spec,
}: {
  spec: TableSpec<Row>;
}) {
  const { title, columns, rows, defaultSortKey, defaultSortDir, emptyMessage } = spec;
  const [sort, setSort] = useState<{ key: string | null; dir: "asc" | "desc" | null }>({
    key: defaultSortKey || null,
    dir: defaultSortKey ? defaultSortDir || "desc" : null,
  });

  const sorted = useMemo(() => {
    if (!sort.key || !sort.dir) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const getter = col?.sortValue;
    if (!getter) return rows;
    const dirMult = sort.dir === "asc" ? 1 : -1;
    const out = [...rows];
    out.sort((ra, rb) => dirMult * compareNullable(getter(ra), getter(rb)));
    return out;
  }, [rows, columns, sort.key, sort.dir]);

  const onToggleSort = (key: string) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "desc" };
      return { key, dir: prev.dir === "desc" ? "asc" : "desc" };
    });
  };

  return (
    <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
      <div className="px-4 py-2 border-b border-border-subtle flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-text-primary truncate">{title}</div>
        <div className="text-[11px] text-text-muted">{sorted.length.toLocaleString()} row(s)</div>
      </div>
      {sorted.length === 0 ? (
        <div className="px-4 py-4 text-sm text-text-muted">{emptyMessage || "No rows."}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-[12px]">
            <thead className="bg-black/10 border-b border-border-subtle">
              <tr>
                {columns.map((c) => {
                  const isSortable = typeof c.sortValue === "function";
                  const isActive = sort.key === c.key && !!sort.dir;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      className={clsx(
                        "px-3 py-2 text-left font-semibold text-text-muted whitespace-nowrap",
                        isSortable && "cursor-pointer select-none hover:text-text-primary",
                        isActive && "text-text-primary",
                        c.className
                      )}
                      onClick={isSortable ? () => onToggleSort(c.key) : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        <span>{c.header}</span>
                        {c.level && (
                          <span className="ml-1 text-[9px] opacity-50 font-mono">{c.level}</span>
                        )}
                        {isActive ? <span className="text-[10px]">{sort.dir === "asc" ? "▲" : "▼"}</span> : null}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {sorted.map((r, idx) => (
                <tr key={r.id ?? String(idx)} className="hover:bg-white/5">
                  {columns.map((c) => (
                    <td key={c.key} className={clsx("px-3 py-2 align-top text-text-secondary", c.className)}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
