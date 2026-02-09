import React, { useState } from 'react';

import type { Claim } from '../../../shared/contract';

interface ForcingPointOption {
  claimId: string;
  label: string;
  text?: string;
}

interface TraversalForcingPointCardProps {
  forcingPoint: {
    id: string;
    type: 'conditional' | 'conflict';
    tier: number;
    question: string;
    condition: string;
    options?: ForcingPointOption[];
    claimId?: string;
    prunes?: string[];
    unlocks?: string[];
  };
  claims: Claim[];
  isResolved: boolean;
  resolution?: { selectedClaimId: string; selectedLabel: string };
  gateResolution?: { satisfied: boolean; userInput?: string };
  onResolveConflict: (forcingPointId: string, claimId: string, label: string) => void;
  onResolveGate: (forcingPointId: string, satisfied: boolean, userInput?: string) => void;
  disabled?: boolean;
}

export const TraversalForcingPointCard: React.FC<TraversalForcingPointCardProps> = ({
  forcingPoint,
  claims,
  isResolved,
  resolution,
  gateResolution,
  onResolveConflict,
  onResolveGate,
  disabled
}) => {
  const [selectedOption, setSelectedOption] = useState<string | null>(
    resolution?.selectedClaimId || null
  );
  const [expanded, setExpanded] = useState(false);
  const [userInput, setUserInput] = useState(gateResolution?.userInput || '');

  React.useEffect(() => {
    setSelectedOption(resolution?.selectedClaimId || null);
  }, [resolution?.selectedClaimId]);

  React.useEffect(() => {
    setUserInput(gateResolution?.userInput || '');
  }, [gateResolution?.userInput]);

  const handleConfirm = () => {
    if (!selectedOption) return;
    const option = forcingPoint.options?.find(opt => opt.claimId === selectedOption);
    if (option) {
      onResolveConflict(forcingPoint.id, option.claimId, option.label);
    }
  };

  let typeIcon = '🔀';
  let typeLabel = 'Decision';

  switch (forcingPoint.type) {
    case 'conflict':
      typeIcon = '⚖️';
      typeLabel = 'Conflict';
      break;
    case 'conditional':
      typeIcon = '🔀';
      typeLabel = 'Conditional';
      break;
  }
  // Fix for TS exhaustiveness: marking the switch as definitive
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _exhaustive: never = forcingPoint.type as never;
  void _exhaustive;

  const normalizedQuestion = String(forcingPoint.question || '').trim();
  const normalizedCondition = String(forcingPoint.condition || '').trim();
  const showCondition = normalizedCondition.length > 0 && normalizedCondition !== normalizedQuestion;

  if (forcingPoint.type !== 'conflict') {
    const resolvedSatisfied = gateResolution?.satisfied;
    return (
      <div className="my-6 p-6 rounded-xl bg-gradient-to-br from-brand-500/5 to-purple-500/5 border-2 border-brand-500/30">
        <div className="flex items-start gap-3 mb-4">
          <span className="text-3xl">{typeIcon}</span>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded-md bg-brand-500/20 text-brand-500 text-xs font-bold uppercase tracking-wide">
                {typeLabel}
              </span>
              {isResolved && typeof resolvedSatisfied === 'boolean' && (
                <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${resolvedSatisfied
                  ? 'bg-green-500/20 text-green-500'
                  : 'bg-red-500/20 text-red-500'
                  }`}>
                  {resolvedSatisfied ? '✓ Yes' : '✗ No'}
                </span>
              )}
            </div>
            <div className="text-base font-bold text-text-primary">
              {normalizedQuestion}
            </div>
            {showCondition && (
              <div className="mt-2 text-sm text-text-muted">
                {normalizedCondition}
              </div>
            )}
          </div>
        </div>

        {isResolved && gateResolution?.userInput && (
          <div className="mt-3 p-3 rounded-lg bg-surface-highlight border border-border-subtle">
            <div className="text-xs text-text-muted mb-1">Your Context:</div>
            <div className="text-sm text-text-primary italic">"{gateResolution.userInput}"</div>
          </div>
        )}

        {!isResolved && !disabled && (
          <div className="mt-4">
            <button
              onClick={() => setExpanded(!expanded)}
              disabled={disabled}
              className="px-3 py-1.5 rounded-lg bg-surface-highlight hover:bg-surface-raised border border-border-subtle text-xs font-medium transition-colors"
            >
              {expanded ? 'Collapse' : 'Resolve'}
            </button>
          </div>
        )}

        {expanded && !isResolved && (
          <div className="mt-4 space-y-3 animate-in fade-in slide-in-from-top-2">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-2" htmlFor={`fp-input-${forcingPoint.id}`}>
                Provide your specific context (optional but recommended):
              </label>
              <textarea
                id={`fp-input-${forcingPoint.id}`}
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                disabled={disabled}
                placeholder="Add any details that make your answer specific"
                className="w-full px-3 py-2 rounded-lg bg-surface-raised border border-border-subtle text-sm text-text-primary placeholder-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onResolveGate(forcingPoint.id, true, userInput.trim() || undefined);
                  setExpanded(false);
                }}
                disabled={disabled}
                className="flex-1 px-4 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-500 font-medium text-sm transition-colors"
              >
                ✓ Yes
              </button>
              <button
                onClick={() => {
                  onResolveGate(forcingPoint.id, false, userInput.trim() || undefined);
                  setExpanded(false);
                }}
                disabled={disabled}
                className="flex-1 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 font-medium text-sm transition-colors"
              >
                ✗ No
              </button>
            </div>
            <button
              onClick={() => setExpanded(false)}
              disabled={disabled}
              className="w-full px-4 py-2 rounded-lg bg-surface-highlight hover:bg-surface-raised border border-border-subtle text-text-secondary font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="my-6 p-6 rounded-xl bg-gradient-to-br from-brand-500/5 to-purple-500/5 border-2 border-brand-500/30">
      <div className="flex items-start gap-3 mb-4">
        <span className="text-3xl">{typeIcon}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded-md bg-brand-500/20 text-brand-500 text-xs font-bold uppercase tracking-wide">
              {typeLabel}
            </span>
            {isResolved && (
              <span className="px-2 py-0.5 rounded-md bg-green-500/20 text-green-500 text-xs font-bold">
                ✓ Resolved
              </span>
            )}
          </div>
          <div className="text-base font-bold text-text-primary">
            {normalizedQuestion}
          </div>
          {showCondition && (
            <div className="mt-2 text-sm text-text-muted">
              {normalizedCondition}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(forcingPoint.options || []).map((option) => {
          const claim = claims.find(c => c.id === option.claimId);
          const detailsText = String(claim?.text || option?.text || '').trim();
          const isSelected = selectedOption === option.claimId;
          const isThisResolved = isResolved && resolution?.selectedClaimId === option.claimId;

          return (
            <button
              key={option.claimId}
              onClick={() => !isResolved && setSelectedOption(option.claimId)}
              disabled={isResolved || disabled}
              className={`w-full h-full p-4 rounded-lg border-2 text-left transition-all ${isThisResolved
                ? 'border-green-500 bg-green-500/10'
                : isSelected
                  ? 'border-brand-500 bg-brand-500/10'
                  : 'border-border-subtle bg-surface-raised hover:border-brand-500/50'
                } ${(isResolved || disabled) && !isThisResolved ? 'opacity-40' : ''}`}
              role="radio"
              aria-checked={isThisResolved || isSelected}
              aria-disabled={isResolved || disabled}
              aria-label={option.label}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center ${isThisResolved
                  ? 'border-green-500 bg-green-500'
                  : isSelected
                    ? 'border-brand-500 bg-brand-500'
                    : 'border-border-subtle'
                  }`}>
                  {(isSelected || isThisResolved) && (
                    <span className="text-white text-xs" aria-hidden="true">✓</span>
                  )}
                </div>

                <div className="flex-1">
                  <div className="font-bold text-text-primary mb-1">
                    {option.label}
                  </div>
                  {detailsText && (
                    <div className="text-sm text-text-muted mb-2">
                      {detailsText}
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {!isResolved && selectedOption && !disabled && (
        <button
          onClick={handleConfirm}
          className="mt-4 w-full px-6 py-3 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-bold transition-colors"
        >
          Confirm Choice
        </button>
      )}
    </div>
  );
};
