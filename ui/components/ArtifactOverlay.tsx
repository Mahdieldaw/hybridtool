// ui/components/ArtifactOverlay.tsx
// Extracted from ProviderResponseBlock.tsx for artifact modal display

import React, { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { toastAtom } from '../state/atoms';
import MarkdownDisplay from './MarkdownDisplay';

export interface Artifact {
    title: string;
    identifier: string;
    content: string;
}

interface ArtifactOverlayProps {
    artifact: Artifact;
    onClose: () => void;
}

/**
 * Full-screen overlay modal for viewing artifact content.
 * Supports copy to clipboard and download as markdown file.
 */
export const ArtifactOverlay: React.FC<ArtifactOverlayProps> = ({ artifact, onClose }) => {
    const setToast = useSetAtom(toastAtom);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(artifact.content);
            setToast({ id: Date.now(), message: 'Copied to clipboard', type: 'info' });
        } catch (error) {
            console.error('Failed to copy artifact:', error);
            setToast({ id: Date.now(), message: 'Failed to copy', type: 'error' });
        }
    }, [artifact.content, setToast]);

    const handleDownload = useCallback(() => {
        try {
            const blob = new Blob([artifact.content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            
            const safeName = artifact.identifier
                .replace(/[\/\\]/g, '_')
                .replace(/[^a-zA-Z0-9._-]/g, '_')
                .replace(/^[\.]+/g, '')
                .slice(0, 200) || 'artifact';
            
            a.download = `${safeName}.md`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                URL.revokeObjectURL(url);
                try { document.body.removeChild(a); } catch { }
            }, 0);
            setToast({ id: Date.now(), message: 'Download started', type: 'info' });
        } catch (error) {
            console.error('Failed to download artifact:', error);
            setToast({ id: Date.now(), message: 'Failed to download', type: 'error' });
        }
    }, [artifact.content, artifact.identifier, setToast]);

    return (
        <div
            className="fixed inset-0 bg-overlay-backdrop z-[9999] flex items-center justify-center p-5"
            onClick={onClose}
        >
            <div
                className="bg-surface-raised border border-border-strong rounded-2xl max-w-[900px] w-full max-h-[90vh] flex flex-col shadow-elevated animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border-subtle">
                    <div>
                        <h3 className="m-0 text-lg text-text-primary font-semibold">
                            📄 {artifact.title}
                        </h3>
                        <div className="text-xs text-text-muted mt-1">
                            {artifact.identifier}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="bg-transparent border-none text-text-muted text-2xl cursor-pointer px-2 py-1 hover:text-text-primary transition-colors"
                        aria-label="Close artifact overlay"
                    >
                        ×
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5 bg-surface custom-scrollbar">
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                        <MarkdownDisplay content={artifact.content} />
                    </div>
                </div>

                {/* Footer */}
                <div className="flex gap-3 p-4 border-t border-border-subtle justify-end">
                    <button
                        onClick={handleCopy}
                        className="bg-surface-raised border border-border-subtle rounded-md px-4 py-2 text-text-secondary text-sm cursor-pointer flex items-center gap-1.5 hover:bg-surface-highlight transition-all"
                    >
                        📋 Copy
                    </button>
                    <button
                        onClick={handleDownload}
                        className="bg-brand-500 border border-brand-400 rounded-md px-4 py-2 text-text-primary text-sm cursor-pointer flex items-center gap-1.5 hover:bg-brand-600 transition-all"
                    >
                        ⬇️ Download
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ArtifactOverlay;
