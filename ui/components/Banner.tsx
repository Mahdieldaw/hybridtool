import React from "react";
import { useAtom } from "jotai";
import { alertTextAtom } from "../state/atoms";

const Banner: React.FC = () => {
  const [alertText, setAlertText] = useAtom(alertTextAtom as any);
  if (!alertText) return null;

  const handleClose = () => setAlertText(null);
  const text = String(alertText);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-[72px] right-3 z-[2000] bg-surface-highest text-text-secondary border border-border-subtle rounded-[10px] px-3 py-2.5 shadow-elevated flex items-center gap-2 max-w-[360px]"
    >
      <span className="text-xs leading-snug">{text}</span>
      <div className="ml-auto flex gap-2">
        <button
          onClick={handleClose}
          aria-label="Close notice"
          className="bg-transparent text-text-muted border border-border-subtle rounded-md px-2 py-1 text-xs cursor-pointer hover:bg-surface-highlight hover:text-text-secondary transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};

export default Banner;

