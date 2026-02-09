import React from 'react';

/**
 * A wrapper around React.lazy that detects if a chunk fails to load
 * (usually due to a new deployment/build) and reloads the page automatically
 * after a few retries.
 */
export function safeLazy<T extends React.ComponentType<any>>(
    importFn: () => Promise<{ default: T }>
) {
    const MAX_RETRIES = 2;
    const MAX_RELOADS = 1; // Limit page reloads to avoid loops
    const RELOAD_COUNTER_KEY = "safeLazyReloads";

    return React.lazy(async () => {
        let retries = 0;

        const load = async (): Promise<{ default: T }> => {
            try {
                const module = await importFn();
                try {
                    // Reset counter on success so next failure in same session can still reload
                    sessionStorage.removeItem(RELOAD_COUNTER_KEY);
                } catch (e) { }
                return module;
            } catch (error: any) {
                const errorName = error?.name || "";
                const errorMessage = error?.message || "";
                const isNetworkError = errorName === "TypeError" || errorMessage.includes("Failed to fetch");
                const isChunkError = errorName === "ChunkLoadError" || errorMessage.includes("Loading chunk");

                if ((isNetworkError || isChunkError) && retries < MAX_RETRIES) {
                    retries++;
                    const delay = Math.pow(2, retries) * 1000;
                    console.warn(`[safeLazy] Load failed, retrying in ${delay}ms (attempt ${retries}/${MAX_RETRIES})...`, error);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return load();
                }

                console.warn("[safeLazy] Lazy load failed after retries, checking reload guard...", error);

                let reloadCount = 0;
                try {
                    reloadCount = parseInt(sessionStorage.getItem(RELOAD_COUNTER_KEY) || "0", 10);
                } catch (e) { }

                if (reloadCount < MAX_RELOADS) {
                    try {
                        sessionStorage.setItem(RELOAD_COUNTER_KEY, String(reloadCount + 1));
                    } catch (e) { }
                    window.location.reload();
                    // Return temporary loading state while browser navigates
                    const ReloadingFallback = () => React.createElement("div", { className: "loading" }, "Reloading...");
                    return { default: ReloadingFallback as unknown as T };
                }

                // Return a user-friendly error component instead of null
                const ErrorFallback = () => React.createElement(
                    'div',
                    {
                        className: 'flex flex-col items-center justify-center p-8 text-text-muted',
                        role: 'alert',
                        'aria-live': 'assertive'
                    },
                    React.createElement(
                        'svg',
                        {
                            className: 'mb-4 w-8 h-8 text-amber-500',
                            fill: 'none',
                            viewBox: '0 0 24 24',
                            stroke: 'currentColor',
                            'aria-hidden': 'true'
                        },
                        React.createElement('path', {
                            strokeLinecap: 'round',
                            strokeLinejoin: 'round',
                            strokeWidth: 2,
                            d: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
                        })
                    ),
                    React.createElement('p', { className: 'mb-4' }, 'Component failed to load'),
                    React.createElement(
                        'button',
                        {
                            type: 'button',
                            className: 'px-4 py-2 bg-surface-raised hover:bg-surface-highlight rounded border border-border-subtle transition-colors',
                            onClick: () => {
                                try {
                                    sessionStorage.removeItem(RELOAD_COUNTER_KEY);
                                } catch (e) { }
                                window.location.reload();
                            },
                            'aria-label': 'Reload page to retry loading component'
                        },
                        'Reload'
                    )
                );
                return { default: ErrorFallback as unknown as T };
            }
        };

        return load();
    });
}
