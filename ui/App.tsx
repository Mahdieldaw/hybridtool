import { useRef, Suspense, useCallback } from "react";
import { useAtom, useAtomValue } from "jotai";
import { usePortMessageHandler } from "./hooks/chat/usePortMessageHandler";
import { useConnectionMonitoring } from "./hooks/useConnectionMonitoring";
import { useHistoryLoader } from "./hooks/useHistoryLoader";
import { useResponsiveLoadingGuard } from "./hooks/ui/useLoadingWatchdog";
import { safeLazy } from "./utils/safeLazy";
const ChatView = safeLazy(() => import("./views/ChatView"));
import Header from "./components/Header";
const HistoryPanel = safeLazy(() => import("./components/HistoryPanel"));
import Banner from "./components/Banner";
import { ReconnectOverlay } from "./components/ReconnectOverlay"; // Import Overlay
import api from "./services/extension-api"; // Import API

const SettingsPanel = safeLazy(() => import("./components/SettingsPanel"));
import { Toast } from "./components/Toast";
import { isHistoryPanelOpenAtom, connectionStatusAtom } from "./state/atoms"; // Import connection atom

import { useInitialization } from "./hooks/useInitialization";
import { useSmartProviderDefaults } from "./hooks/providers/useSmartProviderDefaults";
import { useProviderStatus } from "./hooks/providers/useProviderStatus";
import { useOnClickOutside } from "usehooks-ts";
import { useKey } from "./hooks/ui/useKey";

export default function App() {
  // This is now the entry point for all startup logic.
  const isInitialized = useInitialization();
  useProviderStatus({}, isInitialized);
  useSmartProviderDefaults(isInitialized);

  // Initialize other global side effects that can run after init
  usePortMessageHandler(isInitialized);
  useConnectionMonitoring(isInitialized);
  useHistoryLoader(isInitialized); // Pass the flag to the history loader
  // Non-destructive loading guard: surfaces alerts when idle while loading
  useResponsiveLoadingGuard({ idleWarnMs: 15000, idleCriticalMs: 45000 });

  const [isHistoryOpen, setIsHistoryOpen] = useAtom(isHistoryPanelOpenAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);

  const historyPanelRef = useRef<HTMLDivElement>(null);

  const closePanel = () => setIsHistoryOpen(false);

  const handleReconnect = useCallback(() => {
    api.reconnect();
  }, []);

  useOnClickOutside(historyPanelRef, closePanel);
  useKey("Escape", closePanel);

  // THE INITIALIZATION BARRIER
  if (!isInitialized) {
    // Render a simple loading state or nothing at all.
    // This prevents any child components from running their hooks too early.
    return (
      <div className="flex items-center justify-center h-screen bg-surface-highest">
        <div className="loading-spinner" />
      </div>
    );
  }

  // Once initialized, render the full application.
  return (
    <div className="flex flex-col h-screen w-screen bg-app-gradient min-h-0">
      <Header />
      <Banner />

      {/* Main content area */}
      <div className="flex flex-1 relative min-h-0">

        <main className="chat-main flex-1 flex flex-col relative min-h-0">
          <Suspense fallback={
            <div className="flex items-center justify-center h-full w-full">
              <div className="loading-spinner" />
            </div>
          }>
            <ChatView />
          </Suspense>
        </main>


        {/* History Panel Overlay */}
        {isHistoryOpen && (
          <>
            <div
              className="history-backdrop fixed inset-0 bg-overlay-backdrop/10 backdrop-blur-md z-[2999]"
              onClick={closePanel}
            />
            <div
              ref={historyPanelRef}
              className="fixed top-0 left-0 w-[320px] h-screen z-[3000]"
            >
              <Suspense fallback={null}>
                <HistoryPanel />
              </Suspense>
            </div>
          </>
        )}
      </div>

      {/* Settings Panel - Slides in from right */}
      <Suspense fallback={null}>
        <SettingsPanel />
      </Suspense>

      {/* Reconnect Overlay - Shows when connection was healthy and is now lost */}
      <ReconnectOverlay
        visible={
          isInitialized &&
          !connectionStatus?.isConnected &&
          connectionStatus?.hasEverConnected
        }
        onReconnect={handleReconnect}
      />

      {/* Global Toast Notifications */}
      <Toast />
    </div>
  );
}
