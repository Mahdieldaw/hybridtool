import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAtom, useSetAtom, useAtomValue } from "jotai";
import {
  chatInputValueAtom,
  selectedModelsAtom,
  isLoadingAtom,
  isContinuationModeAtom,
  activeProviderCountAtom,
  isReducedMotionAtom,
  chatInputHeightAtom,
  toastAtom,
  activeProviderTargetAtom,
  currentSessionIdAtom,
  activeRecomputeStateAtom,
  workflowProgressAtom,
  isRoundActiveAtom,
  singularityProviderAtom,
  batchAutoRunEnabledAtom,
  turnIdsAtom,
  turnsMapAtom,
  activeSplitPanelAtom,
} from "../state/atoms";
import { useChat } from "../hooks/chat/useChat";
import api from "../services/extension-api";
import { LLM_PROVIDERS_CONFIG } from "../constants";
import { getProviderName } from "../utils/provider-helpers";
import { PROVIDER_LIMITS } from "../../shared/provider-limits";
import { CouncilOrbs } from "./CouncilOrbs";

interface ChatInputProps {
  onStartMapping?: (prompt: string) => void;
  canShowMapping?: boolean; // ModelTray has >=2 selected and prompt has content
  mappingTooltip?: string;
  mappingActive?: boolean; // disable input and toggles while active
}

const ChatInput = ({
  onStartMapping,
  canShowMapping = false,
  mappingTooltip,
  mappingActive = false,
}: ChatInputProps) => {
  // --- CONNECTED STATE LOGIC ---
  const [isLoading] = useAtom(isLoadingAtom as any) as [boolean, any];

  const [isContinuationMode] = useAtom(isContinuationModeAtom as any) as [boolean, any];
  const [activeProviderCount] = useAtom(activeProviderCountAtom as any) as [number, any];

  const [isReducedMotion] = useAtom(isReducedMotionAtom as any) as [boolean, any];
  const [, setChatInputHeight] = useAtom(chatInputHeightAtom);

  // Streaming UX: hide config orbs during active round
  const isRoundActive = useAtomValue(isRoundActiveAtom);

  // --- PRESENTATION LOGIC ---
  const [prompt, setPrompt] = useAtom(chatInputValueAtom);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [activeTarget, setActiveTarget] = useAtom(activeProviderTargetAtom); // Keep this as useAtom to read activeTarget
  const turnIds = useAtomValue(turnIdsAtom);
  const turnsMap = useAtomValue(turnsMapAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);
  const setActiveRecomputeState = useSetAtom(activeRecomputeStateAtom);
  const [singularityProvider, setSingularityProvider] = useAtom(singularityProviderAtom);
  const [batchAutoRunEnabled, setBatchAutoRunEnabled] = useAtom(batchAutoRunEnabledAtom);
  const closeSplitPanel = useSetAtom(activeSplitPanelAtom);

  const setToast = useSetAtom(toastAtom);

  const { sendMessage, abort } = useChat();

  const toggleBatchGating = useCallback(() => {
    setBatchAutoRunEnabled(prev => !prev);
  }, [setBatchAutoRunEnabled]);

  // Callbacks
  const handleSend = useCallback((prompt: string) => {
    const mode = isContinuationMode ? "continuation" : "new";
    sendMessage(prompt, mode);
  }, [sendMessage, isContinuationMode]);

  const onContinuation = useCallback(async (prompt: string) => {
    if (activeTarget && currentSessionId) {
      try {
        setActiveRecomputeState({
          aiTurnId: activeTarget.aiTurnId,
          stepType: "batch",
          providerId: activeTarget.providerId
        });
        const primitive: any = {
          type: "recompute",
          sessionId: currentSessionId,
          sourceTurnId: activeTarget.aiTurnId,
          stepType: "batch",
          targetProvider: activeTarget.providerId,
          userMessage: prompt,
          useThinking: false,
        };
        await api.executeWorkflow(primitive);
        setActiveTarget(null);
      } catch (error: any) {
        console.error("Failed to execute targeted recompute:", error);
        setToast({ id: Date.now(), message: `Failed to branch ${activeTarget.providerId}: ${error.message || "Unknown error"}`, type: "error" });
        setActiveRecomputeState(null);
      }
      return;
    }
    sendMessage(prompt, "continuation");
  }, [sendMessage, activeTarget, currentSessionId, setActiveTarget, setActiveRecomputeState, setToast]);

  const onAbort = useCallback(() => { void abort(); }, [abort]);

  const onHeightChange = setChatInputHeight;
  const onCancelTarget = () => setActiveTarget(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Clear active target when clicking outside
  useEffect(() => {
    if (!activeTarget) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setActiveTarget(null);
      }
    };
    document.body.addEventListener("click", handleClickOutside);
    return () => document.body.removeEventListener("click", handleClickOutside);
  }, [activeTarget, setActiveTarget]);

  // Input Length Validation State
  const [selectedModels] = useAtom(selectedModelsAtom);
  const [maxLength, setMaxLength] = useState<number>(Infinity);
  const [warnThreshold, setWarnThreshold] = useState<number>(Infinity);
  const [limitingProvider, setLimitingProvider] = useState<string>("");

  const inputLength = prompt.length;
  const isOverLimit = inputLength > maxLength;
  const isWarning = inputLength > warnThreshold && !isOverLimit;

  // Calculate limits based on selected providers
  useEffect(() => {
    let minMax = Infinity;
    let minWarn = Infinity;
    let provider = "";

    const activeProviders = Object.entries(selectedModels)
      .filter(([_, isSelected]) => isSelected)
      .map(([id]) => id);

    const providersToCheck = activeProviders.length > 0 ? activeProviders : ['chatgpt', 'claude', 'gemini'];

    providersToCheck.forEach(pid => {
      const limitConfig = PROVIDER_LIMITS[pid as keyof typeof PROVIDER_LIMITS] || PROVIDER_LIMITS['chatgpt'];

      if (limitConfig.maxInputChars < minMax) {
        minMax = limitConfig.maxInputChars;
        minWarn = limitConfig.warnThreshold;
        provider = getProviderName(pid);
      }
    });

    setMaxLength(minMax);
    setWarnThreshold(minWarn);
    setLimitingProvider(provider);
  }, [selectedModels]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      const newHeight = Math.min(scrollHeight, 120);
      textareaRef.current.style.height = `${newHeight}px`;

      const targetHeight = activeTarget ? 30 : 0;
      const totalHeight = newHeight + 24 + 2 + targetHeight;
      onHeightChange?.(totalHeight);
    }
  }, [prompt, onHeightChange, activeTarget]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
  };

  const executeSend = (text: string) => {
    const trimmed = text.trim();
    if (isOverLimit) {
      setToast({ id: Date.now(), message: `Input too long for ${limitingProvider} (${inputLength.toLocaleString()} / ${maxLength.toLocaleString()})`, type: "error" });
      return;
    }
    closeSplitPanel(null);
    if (isContinuationMode) {
      onContinuation(trimmed);
    } else {
      handleSend(trimmed);
    }

    setPrompt("");
  };

  const handleSubmit = (e?: React.FormEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();
    if (isLoading || !prompt.trim()) return;
    if (isOverLimit) {
      setToast({ id: Date.now(), message: `Input too long for ${limitingProvider} (${inputLength.toLocaleString()} / ${maxLength.toLocaleString()})`, type: "error" });
      return;
    }

    executeSend(prompt);
  };

  const buttonText = (isContinuationMode ? "Continue" : "Send");
  const isDisabled = isLoading || mappingActive || !prompt.trim() || isOverLimit;
  const showMappingBtn = canShowMapping && !!prompt.trim();
  const showAbortBtn = !!onAbort && isLoading;

  const providerName = activeTarget ? getProviderName(activeTarget.providerId) : "";
  const workflowProgress = useAtomValue(workflowProgressAtom);
  const latestAiTurn = React.useMemo(() => {
    for (let i = turnIds.length - 1; i >= 0; i -= 1) {
      const t = turnsMap.get(turnIds[i]);
      if (t && (t as any).type === "ai") return t as any;
    }
    return null;
  }, [turnIds, turnsMap]);
  const isAwaitingTraversal = latestAiTurn?.pipelineStatus === "awaiting_traversal";
  const isInProgress = latestAiTurn?.pipelineStatus === "in_progress";
  const showConfigOrbs = !isRoundActive && !isAwaitingTraversal && !isInProgress;

  return (
    <div ref={containerRef} className="flex justify-center flex-col items-center pointer-events-auto">

      {showConfigOrbs && (
        <div className="relative w-full max-w-[min(900px,calc(100%-24px))] flex justify-center mb-[-8px] z-10 !bg-transparent">
          <CouncilOrbs
            providers={LLM_PROVIDERS_CONFIG}
            voiceProviderId={singularityProvider}
            variant="active"
            workflowProgress={workflowProgress as any}
            isSingularityMode={!batchAutoRunEnabled}
            forceGating={!batchAutoRunEnabled && turnIds.length > 0}
            collapsed={!isRoundActive}
            onCrownMove={(pid) => {
              setSingularityProvider(pid);
              try {
                chrome?.storage?.local?.set?.({
                  provider_lock_settings: {
                    singularity_locked: true,
                    singularity_provider: pid
                  }
                });
              } catch (e) {
                console.error("Failed to save singularity selection:", e);
              }
            }}
          />
        </div>
      )}

      <div className="flex gap-2 items-center relative w-full max-w-[min(900px,calc(100%-24px))] p-2.5 bg-surface border border-border-subtle/60 rounded-t-2xl rounded-b-2xl flex-wrap z-[100] shadow-elevated">

        {activeTarget && (
          <div className="w-full flex items-center justify-between bg-brand-500/10 border border-brand-500/20 rounded-lg px-3 py-1.5 mb-1 animate-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center gap-2 text-xs font-medium text-brand-400">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
              Targeting {providerName}
            </div>
            <button
              onClick={onCancelTarget}
              className="text-xs text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded hover:bg-surface-highlight transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        <div className="flex-1 relative min-w-[200px] flex flex-col gap-2">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={handleInputChange}
            placeholder={
              activeTarget
                ? `Continue conversation with ${providerName}...`
                : isContinuationMode
                  ? "Continue the conversation with your follow-up message..."
                  : "Ask anything... Singularity will orchestrate multiple AI models for you."
            }
            rows={1}
            className={`w-full min-h-[34px] px-3 py-1.5 bg-transparent border-none text-text-primary text-[15px] font-inherit resize-none outline-none overflow-y-auto ${isReducedMotion ? '' : 'transition-all duration-200 ease-out'} placeholder:text-text-muted`}
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === "Enter" && !e.shiftKey && prompt.trim()) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            disabled={isLoading}
          />

          {(isWarning || isOverLimit) && (
            <div className={`absolute bottom-full left-0 mb-2 px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-md border animate-in fade-in slide-in-from-bottom-1 ${isOverLimit
              ? "bg-intent-danger/10 border-intent-danger/30 text-intent-danger"
              : "bg-intent-warning/10 border-intent-warning/30 text-intent-warning"
              }`}>
              {isOverLimit ? (
                <span>
                  ⚠️ Input too long for {limitingProvider} ({inputLength.toLocaleString()} / {maxLength.toLocaleString()})
                </span>
              ) : (
                <span>
                  Approaching limit for {limitingProvider} ({inputLength.toLocaleString()} / {maxLength.toLocaleString()})
                </span>
              )}
            </div>
          )}
        </div>

        <div
          className={`flex items-center gap-1.5 px-2.5 py-1.5 bg-chip-soft border rounded-full text-text-secondary text-xs whitespace-nowrap opacity-90 cursor-pointer transition-colors ${batchAutoRunEnabled ? 'border-border-subtle hover:bg-surface-highlight' : 'border-intent-danger/30 bg-intent-danger/5 hover:bg-intent-danger/10'}`}
          role="button"
          aria-live="polite"
          title={batchAutoRunEnabled ? "Batch Auto-Run Enabled: Providers will run automatically after turn 1" : "Batch Gating Active: Only Singularity will run after turn 1 unless manually triggered"}
          onClick={(e) => {
            e.stopPropagation();
            toggleBatchGating();
          }}
        >
          {isLoading ? (
            <span
              aria-hidden="true"
              className="inline-block w-2 h-2 rounded-full bg-intent-warning animate-pulse"
            />
          ) : batchAutoRunEnabled ? (
            <span
              aria-hidden="true"
              className={`inline-block w-2 h-2 rounded-full bg-intent-success ${!isReducedMotion ? 'animate-pulse' : ''}`}
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex items-center justify-center w-3 h-3 text-intent-danger font-bold text-[10px]"
            >
              ⊘
            </span>
          )}
          <span className={batchAutoRunEnabled ? "text-text-muted" : "text-intent-danger/80"}>
            {batchAutoRunEnabled ? "System" : "Singularity"}
          </span>
          <span className={batchAutoRunEnabled ? "" : "text-intent-danger font-medium"}>
            • {batchAutoRunEnabled ? activeProviderCount : 1}
          </span>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isDisabled}
            className={`px-3 h-[34px] rounded-2xl text-white font-semibold cursor-pointer flex items-center gap-2 min-w-[84px] justify-center ${isDisabled ? 'opacity-50' : 'opacity-100'} bg-gradient-to-r from-brand-500 to-brand-400 ${isReducedMotion ? '' : 'transition-all duration-200 ease-out'}`}
          >
            {isLoading ? (
              <div className="loading-spinner"></div>
            ) : (
              <>
                <span className="text-base">
                  {(isContinuationMode ? "💬" : "✨")}
                </span>
                <span>{buttonText}</span>
              </>
            )}
          </button>
        </div>

        {showAbortBtn && (
          <button
            type="button"
            onClick={() => onAbort?.()}
            title="Stop current workflow"
            className={`px-3 h-[34px] bg-intent-danger/15 border border-intent-danger/45 rounded-2xl text-intent-danger font-semibold cursor-pointer flex items-center gap-2 min-w-[84px] justify-center ${isReducedMotion ? '' : 'transition-all duration-200 ease-out'}`}
          >
            <span className="text-base">⏹️</span>
            <span>Stop</span>
          </button>
        )}

        {showMappingBtn && (
          <button
            type="button"
            onClick={() => {
              onStartMapping?.(prompt.trim());
              setPrompt("");
            }}
            disabled={isLoading || mappingActive}
            title={mappingTooltip || "Mapping with selected models"}
            className={`px-3 h-[34px] bg-chip-soft border border-border-subtle rounded-2xl text-text-secondary font-semibold cursor-pointer flex items-center gap-2 min-w-[100px] justify-center hover:bg-surface-highlight ${isLoading || mappingActive ? 'opacity-50' : 'opacity-100'} ${isReducedMotion ? '' : 'transition-all duration-200 ease-out'}`}
          >
            <span className="text-base">🧩</span>
            <span>Mapping</span>
          </button>
        )}

      </div>

    </div>
  );
};

export default ChatInput;
