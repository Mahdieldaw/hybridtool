/**
 * Math Renderer - FULLY LAZY LOADED
 * 
 * This module has ZERO static imports for the unified/KaTeX ecosystem.
 * All dependencies (~650KB) are loaded dynamically only when math is detected.
 */

// Cache the processor to avoid recreating it
let processor: any = null;

/**
 * Lazy-loads KaTeX and ALL related plugins.
 * This function is only called when math is detected in the content.
 * Returns the full plugin set needed to build a processor.
 */
export async function loadMathPlugins() {
    // Parallel load ALL necessary modules - nothing is statically imported
    const [
        { unified },
        { default: remarkParse },
        { default: remarkMath },
        { default: remarkRehype },
        { default: rehypeKatex },
        { default: rehypeStringify },
        _katex // Loaded for KaTeX CSS side effects
    ] = await Promise.all([
        import('unified'),
        import('remark-parse'),
        import('remark-math'),
        import('remark-rehype'),
        import('rehype-katex'),
        import('rehype-stringify'),
        import('katex')
    ]);

    return {
        unified,
        remarkParse,
        remarkMath,
        remarkRehype,
        rehypeKatex,
        rehypeStringify
    };
}

/**
 * Lazy-loads KaTeX and renders math in markdown content.
 * This function is only called when math is detected in the content.
 */
export async function renderMathInMarkdown(content: string): Promise<string> {
    // 1. Initialize processor if needed
    if (!processor) {
        const {
            unified,
            remarkParse,
            remarkMath,
            remarkRehype,
            rehypeKatex,
            rehypeStringify
        } = await loadMathPlugins();

        processor = unified()
            .use(remarkParse)
            .use(remarkMath)
            .use(remarkRehype)
            .use(rehypeKatex)
            .use(rehypeStringify);
    }

    // 2. Process the content
    try {
        const result = await processor.process(content);
        return String(result);
    } catch (error) {
        console.error('Failed to render math:', error);
        return content; // Fallback to original content
    }
}


