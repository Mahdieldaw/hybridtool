import React, { useState, useCallback } from "react";
import { useSetAtom } from "jotai";
import { toastAtom } from "../state/atoms";
import clsx from "clsx";

interface CopyButtonProps {
    text?: string;
    label?: string; // Aria label
    buttonText?: string; // Visible text next to icon
    variant?: "icon" | "text" | "pill";
    className?: string;
    onCopy?: () => void;
    disabled?: boolean;
    children?: React.ReactNode;
}

export const CopyButton: React.FC<CopyButtonProps> = ({
    text = "",
    label = "Copy to clipboard",
    buttonText,
    variant = "pill",
    className,
    onCopy,
    disabled = false,
    children,
}) => {
    const setToast = useSetAtom(toastAtom);
    const [copied, setCopied] = useState(false);
    const copyTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

    React.useEffect(() => {
        return () => {
            if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
        };
    }, []);

    const handleCopy = useCallback(
        async (e: React.MouseEvent) => {
            e.stopPropagation();
            if (disabled) return;

            if (!text) {
                setToast({ id: Date.now(), message: 'Nothing to copy', type: 'error' });
                return;
            }

            try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setToast({ id: Date.now(), message: 'Copied to clipboard', type: 'info' });
                
                if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
                copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
                
                onCopy?.();
            } catch (error) {
                console.error("Failed to copy text:", error);
                setToast({ id: Date.now(), message: 'Failed to copy', type: 'error' });
            }
        },
        [text, onCopy, setToast, disabled],
    );

    const baseClasses = "transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

    const variantClasses = {
        icon: "p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-highlight rounded-md",
        text: "text-xs font-medium text-text-muted hover:text-text-primary",
        pill: "bg-surface-raised border border-border-subtle rounded-md px-2 py-1 text-text-muted text-xs hover:bg-surface-highlight"
    };

    return (
        <button
            type="button"
            onClick={handleCopy}
            aria-label={label}
            disabled={disabled}
            className={clsx(baseClasses, variantClasses[variant], className)}
            title={label}
        >
            {copied ? (
                <>
                    <span>✓</span>
                    {(children || buttonText || variant === 'pill') && <span>Copied</span>}
                </>
            ) : (
                <>
                    <span>📋</span>
                    {children}
                    {!children && buttonText && <span>{buttonText}</span>}
                    {!children && variant === 'pill' && !buttonText && <span>Copy</span>}
                </>
            )}
        </button>
    );
};
