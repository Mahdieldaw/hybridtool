import { useAtom } from 'jotai';
import { EXAMPLE_PROMPT } from '../config/constants';
import { embeddingModelIdAtom } from '../state';
import { EMBEDDING_MODELS } from '../../src/clustering/config';
import logoIcon from '../../assets/brand/logo-icon.png';

interface WelcomeScreenProps {
  onSendPrompt?: (prompt: string) => void;
  isLoading?: boolean;
}

const WelcomeScreen = ({ onSendPrompt, isLoading }: WelcomeScreenProps) => {
  const [embeddingModelId, setEmbeddingModelId] = useAtom(embeddingModelIdAtom);

  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-10 pb-40 relative">
      {/* Orb Icon */}
      <img src={logoIcon} alt="Singularity AI" className="h-32 w-32 mb-6" />

      {/* Brand Text */}
      <h1 className="text-4xl font-semibold tracking-[0.15em] mb-2 uppercase">
        <span className="text-white">SINGULAR</span>
        <span className="text-brand-400">ITY AI</span>
      </h1>

      <h2 className="text-xl font-medium mb-3 text-text-primary">Intelligence Augmentation</h2>

      <p className="text-base text-text-muted mb-8 max-w-md">
        Ask one question, get synthesized insights from multiple AI models in real-time
      </p>

      {/* Embedding Model Picker */}
      <div className="mb-6 flex flex-col items-center gap-2">
        <p className="text-xs text-text-secondary uppercase tracking-widest">Embedding Model</p>
        <div className="flex gap-2">
          {EMBEDDING_MODELS.map((model) => {
            const isActive = embeddingModelId === model.id;
            return (
              <button
                key={model.id}
                onClick={() => setEmbeddingModelId(model.id)}
                title={model.description}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150 ${
                  isActive
                    ? 'bg-brand-500/20 border-brand-400 text-brand-300'
                    : 'bg-surface-raised border-border-subtle text-text-muted hover:border-border-default hover:text-text-secondary'
                }`}
              >
                {model.displayName}
                <span className="ml-1.5 opacity-60">{model.dimensions}d</span>
              </button>
            );
          })}
        </div>
      </div>

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
    </div>
  );
};

export default WelcomeScreen;
