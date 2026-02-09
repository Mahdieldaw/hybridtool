import React, { useCallback, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { containsMath } from "../utils/math-utils";

// --- 1. HELPER: Language Extractor ---
const ListContext = React.createContext(false);

function getLanguageFromClass(className: string): string {
  const match = /language-([a-zA-Z0-9+#]+)/.exec(String(className || ""));
  return match ? match[1] : "";
}

function languageToExt(lang: string): string {
  switch (String(lang).toLowerCase()) {
    case "js": case "javascript": return "js";
    case "ts": case "typescript": return "ts";
    case "tsx": return "tsx";
    case "jsx": return "jsx";
    case "py": case "python": return "py";
    case "json": return "json";
    case "go": case "golang": return "go";
    case "java": return "java";
    case "ruby": case "rb": return "rb";
    case "bash": case "sh": return "sh";
    case "markdown": case "md": return "md";
    case "yaml": case "yml": return "yml";
    case "html": return "html";
    case "css": return "css";
    case "scss": return "scss";
    case "c": return "c";
    case "cpp": case "c++": return "cpp";
    case "csharp": case "cs": return "cs";
    case "php": return "php";
    case "rust": case "rs": return "rs";
    case "kotlin": case "kt": return "kt";
    case "swift": return "swift";
    default: return "txt";
  }
}

// --- 2. PRE BLOCK (The Container / Card) ---
// Only Triple-Backtick code blocks get wrapped in <pre>.
// This ensures inline code NEVER gets the buttons or box style.
const PreBlock = ({ children }: any) => {
  const codeElement = React.Children.toArray(children).find(
    (child: any) => child.props && child.props.className
  ) as React.ReactElement | undefined;

  const className = codeElement?.props?.className || "";
  const codeText = String(codeElement?.props?.children || "").replace(/\n$/, "");
  const language = getLanguageFromClass(className);

  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { }
  }, [codeText]);

  const handleDownload = useCallback(() => {
    try {
      const blob = new Blob([codeText], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `snippet.${languageToExt(language)}`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); try { document.body.removeChild(a); } catch { } }, 0);
    } catch { }
  }, [codeText, language]);

  return (
    <div className="relative group/code my-3 overflow-x-auto custom-scrollbar border border-border-subtle rounded-lg">
      {/* 
          Background and content wrapper: 
          'w-fit min-w-full' ensures the background extends to 
          cover full content width when scrolling horizontally.
      */}
      <div className="w-fit min-w-full bg-surface-code pt-7 px-3 pb-3 relative">
        {/* Header / Language Label */}
        {language && (
          <div className="absolute top-0 left-0 px-2 py-0.5 text-xs uppercase text-text-muted bg-surface-modal/50 rounded-br pointer-events-none z-[1]">
            {language}
          </div>
        )}

        <pre className="m-0 font-[inherit] bg-transparent whitespace-pre">
          {children}
        </pre>

        {/* Action Buttons */}
        <div className="absolute top-1.5 right-1.5 flex gap-1.5 z-[2]">
          <button
            onClick={handleCopy}
            title="Copy"
            className={`inline-flex items-center gap-1 px-1.5 mx-0.5 bg-chip-active border border-border-brand rounded-pill text-text-primary text-sm font-bold leading-snug cursor-pointer no-underline transition-all
                        ${copied ? 'text-intent-success' : 'text-text-muted'}`}
          >
            {copied ? "✓" : "📋"}
          </button>
          <button
            onClick={handleDownload}
            title="Download"
            className="bg-border-subtle border border-border-subtle rounded-md px-2 py-1
                       text-text-muted text-xs cursor-pointer"
          >
            ⬇️
          </button>
        </div>
      </div>
    </div>
  );
};

// --- 3. CODE COMPONENT (The Text Style) ---
const CodeText = ({ className = '', children, ...props }: any) => {
  const isBlock = className.includes('language-');
  if (isBlock) {
    // fenced/block code: PreBlock / CSS will style
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  // inline code: bubble style
  return (
    <code
      className={`inline font-mono text-xs text-text-primary bg-surface-highlight/80 border border-border-subtle rounded px-1.5 py-0.5 whitespace-normal align-baseline ${className}`}
      {...props}
    >
      {children}
    </code>
  );
};

// --- 4. MAIN EXPORT ---
interface MarkdownDisplayProps {
  content: string;
  components?: Record<string, React.ElementType>;
  className?: string;
}

const MarkdownDisplay: React.FC<MarkdownDisplayProps> = React.memo(
  ({ content, components = {}, className }) => {
    // State for lazy-loaded plugins
    const [mathPlugins, setMathPlugins] = useState<{
      remarkPlugins: any[];
      rehypePlugins: any[];
    }>({ remarkPlugins: [], rehypePlugins: [] });

    const [isMathLoaded, setIsMathLoaded] = useState(false);

    // Effect to handle math rendering
    useEffect(() => {
      let isMounted = true;

      const loadPlugins = async () => {
        // Fast check for math syntax
        if (!containsMath(content)) {
          return;
        }

        // If already loaded, skip
        if (isMathLoaded) return;

        try {
          // Lazy load plugins
          const { loadMathPlugins } = await import("../utils/math-renderer");
          const { remarkMath, rehypeKatex } = await loadMathPlugins();

          if (isMounted) {
            setMathPlugins({
              remarkPlugins: [remarkMath],
              rehypePlugins: [rehypeKatex]
            });
            setIsMathLoaded(true);
          }
        } catch (err) {
          console.error("Failed to load math plugins:", err);
        }
      };

      loadPlugins();

      return () => {
        isMounted = false;
      };
    }, [content, isMathLoaded]);

    return (
      <div className={`markdown-body text-base leading-relaxed ${className || 'text-text-primary'}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, ...mathPlugins.remarkPlugins]}
          rehypePlugins={[...mathPlugins.rehypePlugins]}
          components={{
            // Separate Block vs Inline logic explicitly
            pre: PreBlock,
            code: CodeText,
            a: ({ href, children, ...props }: any) => (
              <a
                href={href}
                {...props}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-400 hover:text-brand-300 underline decoration-brand-400/30 hover:decoration-brand-400 transition-colors"
              >
                {children}
              </a>
            ),
            // ---------------------------

            // Crash Fix: Map paragraphs to divs (or spans in lists)
            p: ({ children }) => {
              const inList = React.useContext(ListContext);
              if (inList) {
                // Force inline rendering for list items to prevent vertical stacking
                return (
                  <span className="inline m-0">
                    {children}
                    <span className="inline-block w-[0.3em]"></span>
                  </span>
                );
              }
              return (
                <div className="mb-4 mt-2">
                  {children}
                </div>
              );
            },
            ul: ({ children }) => <ul className="pl-5 mb-4 list-disc">{children}</ul>,
            ol: ({ children }) => <ol className="pl-5 mb-4 list-decimal">{children}</ol>,
            li: ({ children }) => (
              <ListContext.Provider value={true}>
                <li className="mb-1">{children}</li>
              </ListContext.Provider>
            ),
            h1: ({ children }) => <h1 className="text-2xl font-semibold mt-4 mb-2 text-text-primary">{children}</h1>,
            h2: ({ children }) => <h2 className="text-xl font-semibold mt-3 mb-2 text-text-primary">{children}</h2>,
            h3: ({ children }) => <h3 className="text-lg font-semibold mt-2 mb-1.5 text-text-secondary">{children}</h3>,
            h4: ({ children }) => <h4 className="text-base font-semibold mt-2 mb-1.5 text-text-secondary">{children}</h4>,
            blockquote: ({ children }) => <blockquote className="border-l-4 border-border-subtle pl-4 ml-0 text-text-muted italic">{children}</blockquote>,
            img: ({ src, alt, ...props }: any) => (
              <img
                src={src}
                alt={alt}
                referrerPolicy="no-referrer"
                className="rounded-lg max-w-full h-auto my-2 border border-border-subtle"
                {...props}
              />
            ),

            // --- TABLE STYLING (Restored) ---
            table: ({ children }) => (
              <div className="overflow-x-auto my-4 max-w-full">
                <table className="w-full border-collapse text-base text-text-primary">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => <thead className="bg-chip-soft">{children}</thead>,
            tbody: ({ children }) => <tbody>{children}</tbody>,
            tr: ({ children }) => <tr className="border-b border-border-subtle">{children}</tr>,
            th: ({ children }) => (
              <th className="px-3 py-2 text-left font-semibold text-text-secondary border-b border-border-subtle">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="px-3 py-2 align-top text-text-primary border-b border-border-subtle">
                {children}
              </td>
            ),


            ...components,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  },
  (prev, next) => prev.content === next.content && prev.components === next.components
);

export default MarkdownDisplay;
