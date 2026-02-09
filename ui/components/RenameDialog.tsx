import React, { useEffect, useRef, useState } from "react";

interface RenameDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRename: (title: string) => void;
  defaultTitle: string;
  isRenaming?: boolean;
}

export const RenameDialog: React.FC<RenameDialogProps> = ({
  isOpen,
  onClose,
  onRename,
  defaultTitle,
  isRenaming = false,
}) => {
  const [title, setTitle] = useState(defaultTitle);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTitle(defaultTitle);
  }, [defaultTitle]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Auto-select the whole title for quick renaming
      inputRef.current.focus();
      inputRef.current.selectionStart = 0;
      inputRef.current.selectionEnd = inputRef.current.value.length;
    }
  }, [isOpen]);

  const handleRename = () => {
    const t = String(title || "").trim();
    if (t) onRename(t);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isRenaming) {
        handleRename();
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-overlay-backdrop/70 flex items-center justify-center z-[1000]"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-surface-modal border border-border-subtle rounded-2xl p-6 min-w-[400px] max-w-[500px] shadow-overlay">
        <h3 className="m-0 mb-4 text-lg font-semibold text-text-primary">
          Rename Chat
        </h3>

        <div className="mb-5">
          <label className="block text-sm font-medium text-text-secondary mb-2">
            Chat Title
          </label>
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter chat title..."
            autoFocus
            className="w-full p-3 bg-surface-soft border border-border-subtle rounded-lg
                       text-text-primary text-sm outline-none box-border
                       focus:border-border-brand transition-colors"
          />
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={isRenaming}
            className="px-5 py-2.5 bg-transparent border border-border-subtle rounded-lg
                       text-text-muted text-sm font-medium
                       cursor-pointer disabled:cursor-not-allowed disabled:opacity-60
                       transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleRename}
            disabled={!title.trim() || isRenaming}
            className="px-5 py-2.5 border rounded-lg text-sm font-medium
                       flex items-center gap-2 transition-all active:scale-95
                       enabled:bg-intent-success enabled:border-intent-success enabled:text-white enabled:cursor-pointer
                       disabled:bg-surface-highest/60 disabled:border-border-subtle disabled:text-text-muted disabled:cursor-not-allowed"
          >
            {isRenaming && (
              <div className="w-4 h-4 border-2 border-transparent border-t-current rounded-full animate-spin" />
            )}
            {isRenaming ? "Renaming…" : "Rename"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RenameDialog;
