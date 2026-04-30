import { createPortal } from 'react-dom';

export interface TooltipData {
  x: number;
  y: number;
  title: string;
  subtitle?: string;
  content?: string;
}

export function TooltipOverlay({ tooltip }: { tooltip: TooltipData | null }) {
  if (!tooltip) return null;

  return createPortal(
    <div
      className="fixed z-[100] pointer-events-none bg-black/90 text-white text-xs rounded-lg px-3 py-2 shadow-2xl border border-white/20 backdrop-blur-md max-w-[280px] animate-in fade-in zoom-in-95 duration-150"
      style={{ 
        left: tooltip.x + 16, 
        top: tooltip.y - 12,
        // Ensure tooltip doesn't go off-screen
        transform: 'translateY(-20%)' 
      }}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <span className="font-bold text-text-primary whitespace-nowrap">{tooltip.title}</span>
          {tooltip.subtitle && (
            <span className="font-mono text-[9px] text-white/40 uppercase tracking-tighter">
              {tooltip.subtitle}
            </span>
          )}
        </div>
        {tooltip.content && (
          <div className="text-[11px] text-text-secondary leading-relaxed border-t border-white/5 pt-1 mt-1">
            {tooltip.content}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
