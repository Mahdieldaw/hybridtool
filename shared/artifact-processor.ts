/**
 * ArtifactProcessor - Provider-agnostic artifact extraction
 * 
 * Extracts rich content (SVG, HTML, Markdown) from AI responses and
 * separates them from the main text for specialized rendering.
 */

export interface Artifact {
    title: string;
    identifier: string;
    content: string;
    type: string; // MIME type: 'image/svg+xml', 'text/html', 'text/markdown'
}

export interface ProcessedResponse {
    cleanText: string;
    artifacts: Artifact[];
}

export class ArtifactProcessor {
    private artifactRegex = /<document\s+([^>]+)>([\s\S]*?)<\/document>/g;
    private attrRegex = /(\w+)=(?:"([^"]*)"|'([^']*)'|([^>\s]+))/g;

    /**
     * Process AI response text and extract artifacts
     * @param rawText - The full response text from the AI
     * @returns Processed response with clean text and extracted artifacts
     */
    process(rawText: string): ProcessedResponse {
        if (!rawText || typeof rawText !== 'string') {
            return { cleanText: '', artifacts: [] };
        }

        const artifacts: Artifact[] = [];

        // Extract all <document> tags
        let cleanText = rawText;
        let match: RegExpExecArray | null;

        // Reset regex for document parsing
        this.artifactRegex.lastIndex = 0;
        while ((match = this.artifactRegex.exec(rawText)) !== null) {
            const [fullMatch, attrString, content] = match;

            // Parse attributes
            const attributes: Record<string, string> = {};
            let attrMatch: RegExpExecArray | null;

            // Reset regex for attribute parsing
            this.attrRegex.lastIndex = 0;
            while ((attrMatch = this.attrRegex.exec(attrString)) !== null) {
                const key = attrMatch[1];
                const value = attrMatch[2] || attrMatch[3] || attrMatch[4] || '';
                attributes[key] = value;
            }

            // Auto-detect type if missing (pass identifier for filename-based detection)
            const identifier = attributes.identifier || `artifact-${Date.now()}`;
            let type = attributes.type || this.detectType(content, identifier);

            artifacts.push({
                title: attributes.title || 'Untitled Artifact',
                identifier: identifier,
                content: content.trim(),
                type: type,
            });

            // Remove artifact from main text
            cleanText = cleanText.replace(fullMatch, '');
        }

        return {
            cleanText: cleanText.trim(),
            artifacts,
        };
    }

    /**
     * Auto-detect artifact type from content and identifier
     * Supports both Claude's type attribute and Gemini's filename-based identifiers
     */
    private detectType(content: string, identifier?: string): string {
        // 1. Check identifier extension (Gemini pattern)
        if (identifier) {
            const ext = identifier.toLowerCase();
            if (ext.endsWith('.md')) return 'text/markdown';
            if (ext.endsWith('.svg')) return 'image/svg+xml';
            if (ext.endsWith('.html') || ext.endsWith('.htm')) return 'text/html';
            if (ext.endsWith('.py')) return 'text/x-python';
            if (ext.endsWith('.js')) return 'application/javascript';
            if (ext.endsWith('.json')) return 'application/json';
            if (ext.endsWith('.xml')) return 'application/xml';
            if (ext.endsWith('.css')) return 'text/css';
        }

        // 2. Check content signature (Claude pattern)
        const trimmed = content.trim();

        if (trimmed.startsWith('<svg')) {
            return 'image/svg+xml';
        }
        if (trimmed.startsWith('<!DOCTYPE html') || trimmed.includes('<html')) {
            return 'text/html';
        }
        if (trimmed.startsWith('```')) {
            return 'text/markdown';
        }

        return 'text/plain';
    }

    /**
     * Escape XML attribute values
     */
    private escapeXmlAttr(str: string): string {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    /**
     * Format a single artifact into the <document> XML format
     */
    formatArtifact(artifact: { title: string; identifier: string; content: string }): string {
        const escapedTitle = this.escapeXmlAttr(artifact.title);
        const escapedId = this.escapeXmlAttr(artifact.identifier);
        return `\n\n<document title="${escapedTitle}" identifier="${escapedId}">\n${artifact.content}\n</document>`;
    }

    /**
     * Inject images into text by replacing placeholders or appending
     * @param text - The text containing placeholders like [Image of Title]
     * @param images - Array of image objects { url, title }
     */
    injectImages(text: string, images: Array<{ url: string; title: string }>): string {
        if (!text || !images || images.length === 0) return text;

        let newText = text;
        images.forEach((img) => {
            // Pattern: [Image of Title]
            // We escape the title for regex safety
            const escapedTitle = img.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp(`\\[Image of ${escapedTitle}\\]`, 'g');

            const markdownImage = `![${img.title}](${img.url})`;

            // If the placeholder exists, replace it
            if (pattern.test(newText)) {
                pattern.lastIndex = 0; // Reset after test() to avoid missing matches in replace()
                newText = newText.replace(pattern, markdownImage);
            } else {
                // If placeholder not found, append to bottom
                newText += `\n\n${markdownImage}`;
            }
        });

        return newText;
    }
}
