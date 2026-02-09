import React, { useMemo, useEffect, useRef, Suspense } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  turnIdsAtom,
  showWelcomeAtom,
  currentSessionIdAtom,
  isSplitOpenAtom,
  activeSplitPanelAtom,
  isDecisionMapOpenAtom,
  chatInputHeightAtom,
  powerUserModeAtom,
} from "../state/atoms";
import { ResizableSplitLayout } from "../components/ResizableSplitLayout";
import clsx from "clsx";

import MessageRow from "../components/MessageRow";
import ChatInput from "../components/ChatInput";
import WelcomeScreen from "../components/WelcomeScreen";
import { useChat } from "../hooks/chat/useChat";
import { SplitPaneRightPanel } from "../components/SplitPaneRightPanel";
import { safeLazy } from "../utils/safeLazy";
import { StatementClusteringDebugOverlay } from "../components/debug/StatementClusteringDebugOverlay";

// Lazy load CouncilOrbsVertical - defers orb machinery for faster initial load
const CouncilOrbsVertical = safeLazy(() => import("../components/CouncilOrbsVertical").then(m => ({ default: m.CouncilOrbsVertical })));

// Lazy load DecisionMapSheet (named export adapter)
// Uses safeLazy for robust loading
const DecisionMapSheet = safeLazy(() =>
  import("../components/DecisionMapSheet").then(module => ({ default: module.DecisionMapSheet }))
);

export default function ChatView() {
  const [turnIds] = useAtom(turnIdsAtom as any) as [string[], any];
  const [showWelcome] = useAtom(showWelcomeAtom as any) as [boolean, any];
  const [currentSessionId] = useAtom(currentSessionIdAtom as any) as [
    string | null,
    any,
  ];

  // Split Pane State
  const isSplitOpen = useAtomValue(isSplitOpenAtom);
  const setActiveSplitPanel = useSetAtom(activeSplitPanelAtom);
  const isDecisionMapOpen = useAtomValue(isDecisionMapOpenAtom);
  const setDecisionMapOpen = useSetAtom(isDecisionMapOpenAtom);
  const chatInputHeight = useAtomValue(chatInputHeightAtom);
  const powerUserMode = useAtomValue(powerUserModeAtom);

  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const { selectChat } = useChat();

  // ESC Key Handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDecisionMapOpen) {
          setDecisionMapOpen(null);
        } else if (isSplitOpen) {
          setActiveSplitPanel(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDecisionMapOpen, isSplitOpen, setDecisionMapOpen, setActiveSplitPanel]);

  const itemContent = useMemo(
    () => (_index: number, turnId: string) => {
      if (!turnId) {
        return (
          <div className="p-2 text-intent-danger">
            Error: Invalid turn ID
          </div>
        );
      }
      return <MessageRow turnId={turnId} />;
    },
    [],
  );

  // Memoize Virtuoso Scroller to avoid remounts that can reset scroll position
  type ScrollerProps = Pick<
    React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLDivElement>,
      HTMLDivElement
    >,
    "children" | "style" | "tabIndex"
  >;
  const ScrollerComponent = useMemo(
    () =>
      React.forwardRef<HTMLDivElement, ScrollerProps>((props, ref) => (
        <div
          {...props}
          data-chat-scroller="true"
          ref={(node) => {
            if (typeof ref === "function") ref(node as HTMLDivElement | null);
            else if (ref && "current" in (ref as any))
              (ref as React.MutableRefObject<HTMLDivElement | null>).current =
                node as HTMLDivElement | null;
          }}
          style={{
            ...(props.style || {}),
            WebkitOverflowScrolling: "touch",
          }}
          className="h-full min-h-0 overflow-y-auto"
        />
      )),
    [],
  );

  // Jump-to-turn event listener with optional cross-session loading
  useEffect(() => {
    let aborted = false;
    const handler = async (evt: Event) => {
      try {
        const detail = (evt as CustomEvent<any>).detail || {};
        const targetTurnId: string | undefined =
          detail.turnId || detail.aiTurnId || detail.userTurnId;
        const targetProviderId: string | undefined = detail.providerId;
        const targetSessionId: string | undefined = detail.sessionId;
        if (!targetTurnId || aborted) return;

        const doScroll = () => {
          if (aborted) return;
          try {
            const index = turnIds.findIndex((id) => id === targetTurnId);
            if (index !== -1) {
              virtuosoRef.current?.scrollToIndex({
                index,
                behavior: "smooth",
                align: "center",
              });
            } else {
              // Fallback to DOM query when item is rendered
              const el = document.querySelector(
                `[data-turn-id="${CSS.escape(targetTurnId)}"]`,
              ) as HTMLElement | null;
              if (el && typeof el.scrollIntoView === "function") {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }
            // Brief highlight pulse
            const row =
              document.getElementById(`turn-${targetTurnId}`) ||
              document.querySelector(
                `[data-turn-id="${CSS.escape(targetTurnId)}"]`,
              );
            if (row && row instanceof HTMLElement) {
              row.classList.add('shadow-glow-brand-soft');
              setTimeout(() => {
                if (!aborted) row.classList.remove('shadow-glow-brand-soft');
              }, 1200);
            }
            // Focus provider card if requested - open split pane directly
            if (targetProviderId) {
              setTimeout(() => {
                if (!aborted) {
                  setActiveSplitPanel({
                    turnId: targetTurnId,
                    providerId: targetProviderId
                  });
                }
              }, 120);
            }
          } catch (e) {
            console.warn("[ChatView] doScroll failed", e);
          }
        };

        // Cross-session navigation support
        if (
          targetSessionId &&
          currentSessionId &&
          targetSessionId !== currentSessionId
        ) {
          const summary = {
            id: targetSessionId,
            sessionId: targetSessionId,
            startTime: Date.now(),
            lastActivity: Date.now(),
            title: "",
            firstMessage: "",
            messageCount: 0,
            messages: [],
          };
          await selectChat(summary as any);
          if (aborted) return;
          // Wait a tick for state to settle then scroll
          requestAnimationFrame(() => doScroll());
        } else {
          doScroll();
        }
      } catch (e) {
        console.warn("[ChatView] jump-to-turn handler failed", e);
      }
    };
    document.addEventListener("jump-to-turn", handler as EventListener);
    return () => {
      aborted = true;
      document.removeEventListener("jump-to-turn", handler as EventListener);
    };
  }, [turnIds, currentSessionId, selectChat, setActiveSplitPanel]);

  return (
    <div className="chat-view flex flex-col h-full w-full flex-1 min-h-0 relative">
      {showWelcome ? (
        <WelcomeScreen />
      ) : (
        <ResizableSplitLayout
          className="flex-1 h-full"
          style={{ paddingBottom: (chatInputHeight || 80) + 12 }}
          isSplitOpen={!!isSplitOpen}
          leftPane={
            <Virtuoso
              className="h-full"
              data={turnIds}
              followOutput={(isAtBottom: boolean) => {
                if (!isAtBottom) return false;
                return "smooth";
              }}
              increaseViewportBy={{ top: 300, bottom: 200 }}
              components={{
                Scroller: ScrollerComponent as unknown as React.ComponentType<any>,
                Footer: () => <div style={{ height: 24 }} />
              }}
              itemContent={itemContent}
              computeItemKey={(index, turnId) => turnId || `fallback-${index}`}
              ref={virtuosoRef as any}
            />
          }
          rightPane={<SplitPaneRightPanel />}
          dividerContent={
            <div className="orb-bar pointer-events-auto cursor-default bg-surface-raised border-y border-l border-border-subtle rounded-l-xl shadow-sm p-1 flex flex-col items-center justify-center gap-2" style={{ cursor: 'default' }}>
              <Suspense fallback={
                <div className="flex flex-col items-center gap-3 py-4 w-full">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="w-2 h-2 rounded-full bg-text-secondary/30 animate-pulse" />
                  ))}
                </div>
              }>
                <CouncilOrbsVertical />
              </Suspense>
            </div>
          }
        />
      )}

      {/* Decision Map - Fixed Overlay */}
      <Suspense fallback={null}>
        <DecisionMapSheet />
      </Suspense>
      {powerUserMode && <StatementClusteringDebugOverlay />}

      <div
        className={clsx(
          "absolute left-1/2 -translate-x-1/2 max-w-[min(900px,calc(100%-24px))] z-[50] flex flex-col items-center pointer-events-none transition-opacity duration-300",
          showWelcome ? "bottom-[16px]" : "bottom-0",
        )}
      >
        <ChatInput />
      </div>
    </div>
  );
}
