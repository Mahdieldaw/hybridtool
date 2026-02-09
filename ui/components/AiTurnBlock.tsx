// ui/components/AiTurnBlock.tsx - FIXED ALIGNMENT
import React from "react";
import type { AiTurn } from "../../shared/contract";
import { useSingularityOutput } from "../hooks/useSingularityOutput";


import { CognitiveOutputRenderer } from "./cognitive/CognitiveOutputRenderer";

// --- Helper Functions ---

interface AiTurnBlockProps {
  aiTurn: AiTurn;
}


const AiTurnBlock: React.FC<AiTurnBlockProps> = ({
  aiTurn,
}) => {
  // --- CONNECTED STATE LOGIC ---

  const singularityState = useSingularityOutput(aiTurn.id);

  // --- PRESENTATION LOGIC ---

  const userPrompt: string | null =
    (aiTurn as any)?.userPrompt ??
    (aiTurn as any)?.prompt ??
    (aiTurn as any)?.input ??
    null;



  // --- NEW: Crown Move Handler (Recompute) - REMOVED for historical turns ---
  // The crown is now static for historical turns. Recompute is handled via the button below.


  return (
    <div className="turn-block pb-32 mt-4">
      {userPrompt && (
        <div className="user-prompt-block mt-24 mb-8">
          <div className="text-xs text-text-muted mb-1.5">
            Your Prompt
          </div>
          <div className="bg-surface border border-border-subtle rounded-lg p-3 text-text-secondary">
            {userPrompt}
          </div>
        </div>
      )}

      <div className="ai-turn-block relative group/turn">
        <div className="ai-turn-content flex flex-col gap-3">
          <div className="flex justify-center w-full transition-all duration-300 px-4">
            <div className="w-full max-w-7xl">
              <div className="flex-1 flex flex-col relative min-w-0" style={{ maxWidth: '820px', margin: '0 auto' }}>

                {aiTurn.type === 'ai' ? (
                  <CognitiveOutputRenderer
                    aiTurn={aiTurn}
                    singularityState={singularityState}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(AiTurnBlock);
