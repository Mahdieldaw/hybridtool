import { EXAMPLE_PROMPT } from "../constants";
import logoIcon from "../assets/brand/logo-icon.png";
import { useAtomValue, useSetAtom } from "jotai";
import { powerUserModeAtom, statementClusteringDebugOpenAtom } from "../state/atoms";

interface WelcomeScreenProps {
  onSendPrompt?: (prompt: string) => void;
  isLoading?: boolean;
}

const WelcomeScreen = ({ onSendPrompt, isLoading }: WelcomeScreenProps) => {
  const setStatementClusteringOpen = useSetAtom(statementClusteringDebugOpenAtom);
  const powerUserMode = useAtomValue(powerUserModeAtom);
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-10 pb-40 relative">
      {/* Orb Icon */}
      <img
        src={logoIcon}
        alt="Singularity AI"
        className="h-32 w-32 mb-6"
      />

      {/* Brand Text */}
      <h1 className="text-4xl font-semibold tracking-[0.15em] mb-2 uppercase">
        <span className="text-white">SINGULAR</span>
        <span className="text-brand-400">ITY AI</span>
      </h1>

      <h2 className="text-xl font-medium mb-3 text-text-primary">
        Intelligence Augmentation
      </h2>

      <p className="text-base text-text-muted mb-8 max-w-md">
        Ask one question, get synthesized insights from multiple AI models in
        real-time
      </p>

      {onSendPrompt && (
        <button
          onClick={() => onSendPrompt(EXAMPLE_PROMPT)}
          disabled={isLoading}
          className="text-sm text-text-brand px-4 py-2
                     border border-text-brand rounded-lg
                     bg-chip-soft hover:bg-surface-highlight
                     disabled:cursor-not-allowed disabled:opacity-50
                     transition-all duration-200"
        >
          Try: "{EXAMPLE_PROMPT}"
        </button>
      )}

      {powerUserMode && (
        <button
          onClick={() => setStatementClusteringOpen(true)}
          className="mt-4 text-xs text-text-muted px-3 py-2 border border-border-subtle rounded-lg bg-chip hover:bg-surface-highlight transition-all duration-200"
        >
          Statement clustering debug
        </button>
      )}
    </div>
  );
};

export default WelcomeScreen;
