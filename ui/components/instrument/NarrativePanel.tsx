import MarkdownDisplay from "../MarkdownDisplay";
import { getProviderColor, getProviderConfig } from "../../utils/provider-helpers";

interface NarrativePanelProps {
  narrativeText: string;
  activeMappingPid?: string;
}

export function NarrativePanel({ narrativeText, activeMappingPid }: NarrativePanelProps) {
  const provider = activeMappingPid ? getProviderConfig(activeMappingPid) : undefined;
  const color = activeMappingPid ? getProviderColor(activeMappingPid) : "#8b5cf6";

  if (!narrativeText) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        No narrative available for this mapping.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Provider badge */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <span className="text-[12px] font-medium text-text-primary">
          {provider?.name || activeMappingPid || "Mapper"}
        </span>
        <span className="text-[11px] text-text-muted ml-1">Narrative</span>
      </div>

      {/* Narrative content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4">
        <div className="prose prose-sm prose-invert max-w-none">
          <MarkdownDisplay content={narrativeText} />
        </div>
      </div>
    </div>
  );
}
