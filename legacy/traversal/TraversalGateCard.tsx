import React, { useState } from 'react';
import type { TraversalGate } from '../../../shared/contract';

interface TraversalGateCardProps {
  gate: TraversalGate;
  isResolved: boolean;
  resolution?: { satisfied: boolean; userInput?: string };
  onResolve: (gateId: string, satisfied: boolean, userInput?: string) => void;
}

export const TraversalGateCard: React.FC<TraversalGateCardProps> = ({
  gate,
  isResolved,
  resolution,
  onResolve
}) => {
  const [expanded, setExpanded] = useState(false);
  const [userInput, setUserInput] = useState(resolution?.userInput || '');
  const normalizedQuestion = String(gate.question || '').trim();
  const normalizedCondition = String(gate.condition || '').trim();
  const showCondition = normalizedCondition.length > 0 && normalizedCondition !== normalizedQuestion;

  React.useEffect(() => {
    setUserInput(resolution?.userInput || '');
  }, [resolution?.userInput]);

  const handleResolve = (satisfied: boolean) => {
    onResolve(gate.id, satisfied, userInput.trim() || undefined);
    setExpanded(false);
  };

  const gateIcon = gate.type === 'conditional' ? '🔀' : '🔒';
  const gateColor = gate.type === 'conditional'
    ? 'border-amber-500/50 bg-amber-500/5'
    : 'border-blue-500/50 bg-blue-500/5';

  return (
    <div className={`relative my-4 rounded-xl border-2 ${gateColor} transition-all`}>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{gateIcon}</span>
            <div>
              <div className="text-sm font-bold text-text-primary">
                {gate.type === 'conditional' ? 'Conditional Gate' : 'Prerequisite Gate'}
              </div>
              {gate.blockedClaims.length > 0 && (
                <div className="text-xs text-text-muted">
                  Blocks {gate.blockedClaims.length} claim(s) in next tier
                </div>
              )}
            </div>
          </div>

          {!isResolved && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="px-3 py-1.5 rounded-lg bg-surface-highlight hover:bg-surface-raised border border-border-subtle text-xs font-medium transition-colors"
            >
              {expanded ? 'Collapse' : 'Resolve'}
            </button>
          )}

          {isResolved && (
            <div className={`px-3 py-1.5 rounded-lg text-xs font-bold ${resolution?.satisfied
              ? 'bg-green-500/10 text-green-500 border border-green-500/30'
              : 'bg-red-500/10 text-red-500 border border-red-500/30'
              }`}>
              {resolution?.satisfied ? '✓ Satisfied' : '✗ Not Applicable'}
            </div>
          )}
        </div>

        <div className="mt-2 text-sm font-bold text-text-primary">
          {normalizedQuestion}
        </div>
        {showCondition && (
          <div className="mt-1 text-xs text-text-muted">
            {normalizedCondition}
          </div>
        )}

        {isResolved && resolution?.userInput && (
          <div className="mt-3 p-3 rounded-lg bg-surface-highlight border border-border-subtle">
            <div className="text-xs text-text-muted mb-1">Your Context:</div>
            <div className="text-sm text-text-primary italic">"{resolution.userInput}"</div>
          </div>
        )}

        {expanded && !isResolved && (
          <div className="mt-4 space-y-3 animate-in fade-in slide-in-from-top-2">
            {gate.type === 'conditional' && (
              <div>
                <label className="block text-xs font-medium text-text-muted mb-2" htmlFor={`gate-input-${gate.id}`}>
                  Provide your specific context (optional but recommended):
                </label>
                <textarea
                  id={`gate-input-${gate.id}`}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  placeholder="E.g., 'I'm building a REST API for a mobile app' or 'This is for a hobby project, not production'"
                  className="w-full px-3 py-2 rounded-lg bg-surface-raised border border-border-subtle text-sm text-text-primary placeholder-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
                  rows={3}
                />
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => handleResolve(true)}
                className="flex-1 px-4 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-500 font-medium text-sm transition-colors"
              >
                ✓ Yes, this applies
              </button>
              <button
                onClick={() => handleResolve(false)}
                className="flex-1 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 font-medium text-sm transition-colors"
              >
                ✗ No, not relevant
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
