import clsx from "clsx";
import type { InstrumentState, InstrumentActions } from "../../hooks/useInstrumentState";

interface ToggleBarProps {
  state: InstrumentState;
  actions: InstrumentActions;
  hasBasinData: boolean;
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <label className={clsx("flex items-center gap-1.5 cursor-pointer select-none", disabled && "opacity-40 cursor-default")}>
      <input type="checkbox" className="rounded" checked={checked} onChange={onChange} disabled={disabled} />
      {label}
    </label>
  );
}

export function ToggleBar({ state, actions, hasBasinData }: ToggleBarProps) {
  return (
    <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between gap-3 flex-none">
      <div className="text-[11px] text-text-muted">ParagraphSpace</div>
      <div className="flex items-center gap-3 text-[11px] text-text-muted">
        <Toggle label="Mutual" checked={state.showMutualEdges} onChange={actions.toggleMutualEdges} />
        <Toggle label="Claims" checked={state.showClaimDiamonds} onChange={actions.toggleClaimDiamonds} />
        <Toggle label="Mapper Edges" checked={state.showMapperEdges} onChange={actions.toggleMapperEdges} />
        <Toggle label="Hulls" checked={state.showRegionHulls} onChange={actions.toggleRegionHulls} />
        <Toggle label="Basins" checked={state.showBasinRects} onChange={actions.toggleBasinRects} disabled={!hasBasinData} />
      </div>
    </div>
  );
}
