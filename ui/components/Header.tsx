import { useAtom, useSetAtom } from "jotai";
import { isHistoryPanelOpenAtom, isSettingsOpenAtom } from "../state/atoms";
import logoIcon from "../assets/brand/logo-icon.png";

// MenuIcon component (inline for simplicity)
const MenuIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="3" y1="12" x2="21" y2="12"></line>
    <line x1="3" y1="6" x2="21" y2="6"></line>
    <line x1="3" y1="18" x2="21" y2="18"></line>
  </svg>
);

const GearIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
);

export default function Header() {
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useAtom(
    isHistoryPanelOpenAtom,
  );
  const setIsSettingsOpen = useSetAtom(isSettingsOpenAtom);

  return (
    <header className="flex items-center justify-between px-4 py-2.5 bg-header-gradient backdrop-blur-lg border-b border-border-subtle shrink-0 text-text-secondary">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setIsHistoryPanelOpen(!isHistoryPanelOpen)}
          className="bg-transparent border-0 text-text-secondary cursor-pointer p-1 hover:text-text-primary transition-colors"
          aria-label="Toggle History Panel"
        >
          <MenuIcon className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          {/* Orb Icon */}
          <img
            src={logoIcon}
            alt=""
            className="w-5 h-5"
          />
          {/* Wordmark - ALWAYS VISIBLE */}
          <span className="font-semibold text-base tracking-wide">
            <span className="text-text-primary">SINGULAR</span>
            <span className="text-brand-400">ITY</span>
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          className="px-3 py-2 bg-surface-highlight border border-border-strong rounded-lg text-text-secondary cursor-pointer transition-all duration-200 hover:bg-surface-raised flex items-center gap-2"
          onClick={() => setIsSettingsOpen(true)}
          aria-label="Open models settings"
        >
          <GearIcon className="w-4 h-4" />
          <span>Models</span>
        </button>
      </div>
    </header>
  );
}
