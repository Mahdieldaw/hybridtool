import  { useEffect } from 'react';
import { useAtom } from 'jotai';
import { toastAtom } from '../state/atoms';
import clsx from 'clsx';

export function Toast() {
    const [toast, setToast] = useAtom(toastAtom);

    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => {
                setToast(null);
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [toast, setToast]);

    if (!toast) return null;

    return (
        <div 
            className="fixed bottom-4 right-4 z-[2000] animate-[slideInUp_0.2s_ease-out]"
            role="status"
            aria-live="polite"
            aria-atomic="true"
        >
            <div className={clsx(
                "bg-surface-raised border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary shadow-card-sm flex items-center gap-2",
                toast.type === 'success' && "border-intent-success/30",
                toast.type === 'error' && "border-intent-danger/30"
            )}>
                {toast.type === 'success' && <span className="text-intent-success">✓</span>}
                {toast.type === 'error' && <span className="text-intent-danger">✕</span>}
                {toast.type === 'info' && <span className="text-brand-400">ℹ</span>}
                {toast.message}
            </div>
        </div>
    );
}
