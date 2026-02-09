import React, { useCallback, useMemo, useState, Suspense, useEffect } from "react";
import { createPortal } from "react-dom";
import { Virtuoso } from "react-virtuoso";
import { useAtomValue, useSetAtom } from "jotai";
import {
  historySessionsAtom,
  isHistoryLoadingAtom,
  isHistoryPanelOpenAtom,
  currentSessionIdAtom,
  toastAtom
} from "../state/atoms";
import { useChat } from "../hooks/chat/useChat";
import api from "../services/extension-api";
import { normalizeBackendRoundsToTurns } from "../utils/turn-helpers";
import { formatSessionForMarkdown, sanitizeSessionForExport } from "../utils/copy-format-utils";
import logoIcon from "../assets/brand/logo-icon.png";
import { PlusIcon, TrashIcon, EllipsisHorizontalIcon, ChevronRightIcon } from "./Icons";
import { HistorySessionSummary } from "../types";

type SessionRowProps = {
  session: HistorySessionSummary;
  isActive: boolean;
  isBatchMode: boolean;
  isSelected: boolean;
  isDeleting: boolean;
  showMenu: boolean;
  onRowClick: (session: HistorySessionSummary) => void;
  onToggleSelected: (sessionId: string) => void;
  onMenuClick: (
    e: React.MouseEvent<HTMLButtonElement>,
    sessionId: string,
  ) => void;
};

const SessionRow = React.memo(function SessionRow({
  session,
  isActive,
  isBatchMode,
  isSelected,
  isDeleting,
  showMenu,
  onRowClick,
  onToggleSelected,
  onMenuClick,
}: SessionRowProps) {
  const sessionId = session.sessionId || session.id;

  return (
    <div
      className={`
                    group relative rounded-lg border transition-all duration-200 cursor-pointer
                    ${isActive
          ? "bg-surface-highlight border-primary-500/50 shadow-sm"
          : "bg-surface-raised border-transparent hover:border-border-subtle"
        }
                    ${isDeleting ? "opacity-50 pointer-events-none" : ""}
                  `}
      onClick={() => onRowClick(session)}
    >
      <div className="p-3">
        <div className="flex justify-between items-start gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {isBatchMode && (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(e) => {
                  e.stopPropagation();
                  onToggleSelected(sessionId);
                }}
                className="flex-shrink-0 accent-brand-500"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs text-text-muted mb-1">
                <span>
                  {new Date(
                    session.lastActivity || session.startTime,
                  ).toLocaleDateString()}
                </span>
                {session.messageCount > 0 && (
                  <span className="bg-surface-highlight px-1.5 py-0.5 rounded-full text-[10px]">
                    {session.messageCount} msg
                  </span>
                )}
              </div>
              <span className="overflow-wrap-anywhere break-words whitespace-normal text-sm font-medium text-text-primary block leading-tight">
                {session.title || "Untitled Chat"}
              </span>
            </div>
          </div>

          {showMenu && (
            <div className="relative ml-1 -mr-1">
              <button
                className="p-1 rounded-md hover:bg-surface-base text-text-secondary transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                onClick={(e) => onMenuClick(e, sessionId)}
              >
                <EllipsisHorizontalIcon className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

const RenameDialog = React.lazy(() => import("./RenameDialog"));

export default function HistoryPanel() {
  // Connected State
  const sessions = useAtomValue(historySessionsAtom);
  const isLoading = useAtomValue(isHistoryLoadingAtom);
  const isOpen = useAtomValue(isHistoryPanelOpenAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const setHistorySessions = useSetAtom(historySessionsAtom);
  const setIsHistoryPanelOpen = useSetAtom(isHistoryPanelOpenAtom);
  const setToast = useSetAtom(toastAtom);
  const { newChat, selectChat, deleteChat, deleteChats } = useChat();

  // Local State
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [renameDefaultTitle, setRenameDefaultTitle] = useState<string>("");
  const [isRenaming, setIsRenaming] = useState<boolean>(false);
  /* New State for Menus */
  const [activeMenu, setActiveMenu] = useState<{ id: string; top: number; left: number; align: 'top' | 'bottom' } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  /* New State for Submenu Position */
  const [exportSubmenuPos, setExportSubmenuPos] = useState<{ top: number; left: number; sessionId: string; align: 'top' | 'bottom' } | null>(null);

  const submenuTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const submenuRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null); // For main menu

  const handleSubmenuEnter = (sessionId: string, rect: DOMRect) => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current);
      submenuTimeoutRef.current = null;
    }

    // Check vertical space for submenu (approx height ~150px)
    const spaceBelow = window.innerHeight - rect.bottom;
    const submenuHeight = 150;
    const align = spaceBelow < submenuHeight ? 'top' : 'bottom';

    // Calculate top position
    let top = rect.top;
    if (align === 'top') {
      // Shift up by height of submenu
      // +10 fudge factor ensures overlap so mouse doesn't disconnect on transition
      top = rect.bottom - submenuHeight + 10;
    }

    setExportSubmenuPos({
      sessionId,
      top, // <--- CHANGE THIS: Use the variable you calculated above
      left: rect.right,
      align
    });
  };

  const handleSubmenuLeave = () => {
    submenuTimeoutRef.current = setTimeout(() => {
      setExportSubmenuPos(null);
    }, 150); // 150ms grace period
  };

  // Ensure cleanup on unmount
  useEffect(() => {
    return () => {
      if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // Don't close if clicking inside the export submenu or main menu
      if (submenuRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setActiveMenu(null);
      setExportSubmenuPos(null);
    };
    window.addEventListener("mousedown", handleClickOutside); // Mousedown is better for immediate closure
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Derived State
  const filteredSessions = useMemo(() => {
    const base = !searchTerm
      ? sessions
      : sessions.filter((s) => s.title?.toLowerCase().includes(searchTerm.toLowerCase()));

    return [...base].sort(
      (a, b) => (b.lastActivity || 0) - (a.lastActivity || 0),
    );
  }, [sessions, searchTerm]);

  // Handlers
  const handleNewChat = useCallback(() => {
    newChat();
    setIsHistoryPanelOpen(false);
  }, [newChat, setIsHistoryPanelOpen]);

  const handleSelectSession = useCallback((session: HistorySessionSummary) => {
    selectChat(session);
    setIsHistoryPanelOpen(false);
  }, [selectChat, setIsHistoryPanelOpen]);

  const handleDeleteChat = async (sessionId: string) => {
    // Track pending deletion
    setDeletingIds((prev) => {
      const next = new Set(prev);
      next.add(sessionId);
      return next;
    });

    // Optimistically remove from panel
    const prevSessions = sessions;
    setHistorySessions((draft: any) =>
      draft.filter((s: any) => (s.sessionId || s.id) !== sessionId),
    );

    const ok = await deleteChat(sessionId);

    // Revalidate against backend to prevent flicker-and-revert when SW response is delayed
    try {
      const response = await api.getHistoryList();
      const refreshed = (response?.sessions || []).map((s: any) => ({
        id: s.sessionId,
        sessionId: s.sessionId,
        title: s.title || "Untitled",
        startTime: s.startTime || Date.now(),
        lastActivity: s.lastActivity || Date.now(),
        messageCount: s.messageCount || 0,
        firstMessage: s.firstMessage || "",
        messages: [],
      }));

      setHistorySessions(refreshed as any);

      const stillExists = refreshed.some(
        (s: any) => (s.sessionId || s.id) === sessionId,
      );
      // If the deleted session was active, clear the chat view immediately
      if (!stillExists && currentSessionId === sessionId) {
        newChat();
      }
    } catch (e) {
      console.error(
        "[HistoryPanel] Failed to refresh history after deletion:",
        e,
      );
      if (!ok) {
        // If the delete call failed and we also failed to refresh, revert UI to previous list
        setHistorySessions(prevSessions as any);
      }
    }

    // Clear pending state
    setDeletingIds((prev) => {
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  };

  const handleToggleBatchMode = useCallback(() => {
    setIsBatchMode((prev) => !prev);
    setSelectedIds(new Set());
  }, []);

  const handleToggleSelected = useCallback((sessionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);

  const handleSessionRowClick = useCallback(
    (session: HistorySessionSummary) => {
      const sessionId = session.sessionId || session.id;
      const isDeleting = !!deletingIds && deletingIds.has(sessionId);
      if (isDeleting) return;

      if (isBatchMode) {
        handleToggleSelected(sessionId);
      } else {
        handleSelectSession(session);
      }
    },
    [deletingIds, handleSelectSession, handleToggleSelected, isBatchMode],
  );

  const handleSessionMenuClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, sessionId: string) => {
      e.stopPropagation();

      const rect = e.currentTarget.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const menuHeight = 120;
      const align = spaceBelow < menuHeight ? "top" : "bottom";

      setActiveMenu((prev) => {
        if (prev && prev.id === sessionId) return null;
        return {
          id: sessionId,
          left: rect.right - 130,
          top: align === "bottom" ? rect.bottom : rect.top,
          align,
        };
      });
    },
    [],
  );

  const handleConfirmBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      // If nothing selected, just exit batch mode
      setIsBatchMode(false);
      return;
    }

    // Optimistically remove selected sessions
    const prevSessions = sessions;
    setHistorySessions((draft: any) =>
      draft.filter((s: any) => !ids.includes(s.sessionId || s.id)),
    );

    try {
      await deleteChats(ids);
      // Revalidate list with backend
      const response = await api.getHistoryList();
      const refreshed = (response?.sessions || []).map((s: any) => ({
        id: s.sessionId,
        sessionId: s.sessionId,
        title: s.title || "Untitled",
        startTime: s.startTime || Date.now(),
        lastActivity: s.lastActivity || Date.now(),
        messageCount: s.messageCount || 0,
        firstMessage: s.firstMessage || "",
        messages: [],
      }));
      setHistorySessions(refreshed as any);
    } catch (e) {
      console.error("[HistoryPanel] Batch delete failed:", e);
      // revert UI list on failure
      setHistorySessions(prevSessions as any);
    } finally {
      setIsBatchMode(false);
      setSelectedIds(new Set());
    }
  };

  const openRenameDialog = (sessionId: string, currentTitle: string) => {
    setRenameSessionId(sessionId);
    setRenameDefaultTitle(currentTitle || "Untitled");
  };

  const closeRenameDialog = () => {
    if (isRenaming) return; // prevent closing during active rename to avoid accidental state issues
    setRenameSessionId(null);
    setRenameDefaultTitle("");
  };

  const handleRenameChat = async (newTitle: string) => {
    const sessionId = renameSessionId;
    if (!sessionId) return;
    setIsRenaming(true);

    // Optimistically update local history list
    const prevSessions = sessions;
    setHistorySessions((draft: any) =>
      draft.map((s: any) => {
        const id = s.sessionId || s.id;
        if (id === sessionId) {
          return { ...s, title: newTitle };
        }
        return s;
      }),
    );

    try {
      const res = await api.renameSession(sessionId, newTitle);

      if (!res?.updated) {
        throw new Error("Rename failed");
      }
      // Revalidate with backend list to ensure consistency
      try {
        const response = await api.getHistoryList();
        const refreshed = (response?.sessions || []).map((s: any) => ({
          id: s.sessionId,
          sessionId: s.sessionId,
          title: s.title || "Untitled",
          startTime: s.startTime || Date.now(),
          lastActivity: s.lastActivity || Date.now(),
          messageCount: s.messageCount || 0,
          firstMessage: s.firstMessage || "",
          messages: [],
        }));
        setHistorySessions(refreshed as any);
      } catch (e) {
        console.warn(
          "[HistoryPanel] Failed to refresh after rename, keeping optimistic title:",
          e,
        );
      }
      closeRenameDialog();
    } catch (e) {
      console.error("[HistoryPanel] Rename failed:", e);
      // revert optimistic update
      setHistorySessions(prevSessions as any);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleExportChat = async (sessionId: string, format: 'json-safe' | 'json-full' | 'markdown') => {
    try {
      const sessionPayload = await api.getSession(sessionId);
      if (!sessionPayload) throw new Error("Could not fetch session data");

      // Normalize the raw backend rounds to proper TurnMessage[]
      const normalizedTurns = normalizeBackendRoundsToTurns(sessionPayload.turns || [], sessionId);
      const normalizedSession = {
        ...sessionPayload,
        turns: normalizedTurns
      };

      let blob: Blob;
      let filename: string;

      if (format === 'markdown') {
        const markdown = formatSessionForMarkdown(normalizedSession);
        blob = new Blob([markdown], { type: "text/markdown" });
        filename = `singularity_export_${(normalizedSession.title || "session").replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
      } else {
        const mode = format === 'json-full' ? 'full' : 'safe';
        const exportData = sanitizeSessionForExport(normalizedSession, mode);
        const jsonString = JSON.stringify(exportData, null, 2);
        blob = new Blob([jsonString], { type: "application/json" });

        const safeTitle = (exportData.session.title || "session").replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const suffix = format === 'json-full' ? '_backup' : '';
        filename = `singularity_export_${safeTitle}${suffix}_${exportData.exportedAt}.json`;
      }


      // Use a timeout to ensure the DOM update happens and separate from the sync stack if needed
      setTimeout(() => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.style.display = 'none';

        document.body.appendChild(link);
        link.click();

        // Delay cleanup to ensure download starts
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }, 1000);
      }, 0);

      setToast({ id: Date.now(), message: "Export started...", type: "success" });
    } catch (error) {
      console.error("Export failed:", error);
      setToast({ id: Date.now(), message: "Failed to export session", type: "error" });
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={(e) => {
          // Don't close if clicking submenu or main menu (already handled by mousedown, but for safety)
          if (submenuRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) {
            return;
          }
          setIsHistoryPanelOpen(false);
        }}
      />

      {/* Portal for Export Submenu */}
      {exportSubmenuPos && createPortal(
        <div
          ref={submenuRef}
          className="fixed z-[10000] w-48 bg-surface-raised border border-border-subtle rounded-lg shadow-xl flex flex-col py-1"
          style={{
            top: exportSubmenuPos.top,
            left: exportSubmenuPos.left,
            pointerEvents: 'auto',
          }}
          onMouseEnter={() => {
            if (submenuTimeoutRef.current) {
              clearTimeout(submenuTimeoutRef.current);
              submenuTimeoutRef.current = null;
            }
          }}
          onMouseLeave={handleSubmenuLeave}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <button
            type="button"
            className="text-left px-3 py-2 text-sm hover:bg-surface-highlight text-text-primary transition-colors"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const sessionId = exportSubmenuPos.sessionId;
              setActiveMenu(null);
              setExportSubmenuPos(null);
              handleExportChat(sessionId, 'json-safe');
            }}
          >
            JSON (Safe)
          </button>
          <button
            type="button"
            className="text-left px-3 py-2 text-sm hover:bg-surface-highlight text-text-primary transition-colors"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const sessionId = exportSubmenuPos.sessionId;
              setActiveMenu(null);
              setExportSubmenuPos(null);
              handleExportChat(sessionId, 'json-full');
            }}
          >
            JSON (Full Backup)
          </button>
          <button
            type="button"
            className="text-left px-3 py-2 text-sm hover:bg-surface-highlight text-text-primary transition-colors"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const sessionId = exportSubmenuPos.sessionId;
              setActiveMenu(null);
              setExportSubmenuPos(null);
              handleExportChat(sessionId, 'markdown');
            }}
          >
            Markdown
          </button>
        </div>,
        document.body
      )}

      {/* Portal for Main Menu */}
      {activeMenu && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] w-32 bg-surface-raised border border-border-subtle rounded-lg shadow-xl flex flex-col py-1"
          style={{
            top: activeMenu.align === 'bottom' ? activeMenu.top : undefined,
            bottom: activeMenu.align === 'top' ? (window.innerHeight - activeMenu.top) : undefined,
            left: activeMenu.left,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="text-left px-3 py-2 text-sm hover:bg-surface-highlight text-text-primary flex items-center gap-2 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              // Find the session title from sessions list
              const sess = sessions.find(s => (s.sessionId || s.id) === activeMenu.id);
              if (sess) openRenameDialog(sess.sessionId || sess.id, sess.title);
              setActiveMenu(null);
            }}
          >
            <span className="text-xs">✏️</span> Rename
          </button>

          <div
            className="relative w-full"
            onMouseEnter={(e) => {
              if (submenuTimeoutRef.current) {
                clearTimeout(submenuTimeoutRef.current);
                submenuTimeoutRef.current = null;
              }
              const rect = e.currentTarget.getBoundingClientRect();
              handleSubmenuEnter(activeMenu.id, rect);
            }}
            onMouseLeave={handleSubmenuLeave}
          >
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-surface-highlight text-text-primary flex items-center justify-between transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs">💾</span> Export
              </div>
              <ChevronRightIcon className="w-4 h-4 text-text-muted" />
            </button>
          </div>

          <div className="h-px bg-border-subtle my-1" />

          <button
            className="text-left px-3 py-2 text-sm hover:bg-intent-danger/10 text-intent-danger flex items-center gap-2 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteChat(activeMenu.id);
              setActiveMenu(null);
            }}
          >
            <span className="text-xs">🗑️</span> Delete
          </button>
        </div>,
        document.body
      )}

      <div className="relative w-full h-full bg-surface-base shadow-2xl z-50 flex flex-col border-r border-border-subtle">
        {/* Header */}
        <div className="p-4 border-b border-border-subtle flex items-center justify-between bg-surface-base/95 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <img src={logoIcon} className="w-6 h-6" alt="Singularity" />
            <h2 className="text-lg font-semibold text-text-primary">History</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewChat}
              className="p-2 hover:bg-surface-highlight rounded-full transition-colors text-text-secondary hover:text-primary-500"
              title="New Chat"
            >
              <PlusIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-border-subtle">
          <input
            type="text"
            placeholder="Search conversations..."
            className="w-full bg-surface-input border border-border-subtle rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary-500 placeholder-text-muted"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Batch Actions */}
        <div className="px-4 pt-2 flex gap-2">
          <button
            onClick={() => {
              if (!isBatchMode) {
                handleToggleBatchMode();
                return;
              }
              const count = selectedIds ? selectedIds.size : 0;
              if (count > 0) {
                handleConfirmBatchDelete();
              } else {
                // If none selected, exit batch mode
                handleToggleBatchMode();
              }
            }}
            className={`flex-1 flex items-center justify-center px-3 py-2 rounded-lg border cursor-pointer transition-all duration-200 text-sm ${isBatchMode
              ? "bg-intent-danger/15 border-intent-danger/45 text-text-secondary hover:bg-intent-danger/20"
              : "bg-surface-raised border-border-subtle text-text-secondary hover:bg-surface-highlight hover:border-border-strong"
              }`}
          >
            <div className="flex items-center gap-2">
              <TrashIcon className="w-4 h-4" />
              <span>{isBatchMode ? (selectedIds.size > 0 ? `Delete (${selectedIds.size})` : "Delete") : "Select"}</span>
            </div>
          </button>
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-text-muted text-sm">
              Loading history...
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-text-muted text-sm gap-2">
              <span className="text-2xl">📭</span>
              <span>No conversations found</span>
            </div>
          ) : (
            <Virtuoso
              data={filteredSessions}
              style={{ height: "100%" }}
              itemContent={(_, session) => {
                const sessionId = session.sessionId || session.id;
                const isActive = currentSessionId === sessionId;
                const isDeleting = !!deletingIds && deletingIds.has(sessionId);
                const isSelected = selectedIds.has(sessionId);

                return (
                  <div className="pb-2">
                    <SessionRow
                      session={session}
                      isActive={isActive}
                      isBatchMode={isBatchMode}
                      isSelected={isSelected}
                      isDeleting={isDeleting}
                      showMenu={!isBatchMode}
                      onRowClick={handleSessionRowClick}
                      onToggleSelected={handleToggleSelected}
                      onMenuClick={handleSessionMenuClick}
                    />
                  </div>
                );
              }}
              computeItemKey={(index, session) =>
                String(session.sessionId || session.id || `session-${index}`)
              }
            />
          )}
        </div>
      </div>

      <Suspense fallback={null}>
        {renameSessionId && (
          <RenameDialog
            isOpen={!!renameSessionId}
            onClose={closeRenameDialog}
            onRename={handleRenameChat}
            defaultTitle={renameDefaultTitle}
            isRenaming={isRenaming}
          />
        )}
      </Suspense>
    </>
  );
}
