import React from "react";
import { motion, AnimatePresence } from "framer-motion";

interface ReconnectOverlayProps {
    visible: boolean;
    onReconnect: () => void;
}

export const ReconnectOverlay: React.FC<ReconnectOverlayProps> = ({
    visible,
    onReconnect
}) => {
    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-md"
                >
                    <div className="flex flex-col items-center gap-6 p-8 rounded-2xl bg-[#0f111a] border border-white/10 shadow-2xl max-w-sm w-full mx-4 text-center">
                        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center animate-pulse">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
                                <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                                <line x1="12" x2="12" y1="2" y2="12" />
                            </svg>
                        </div>

                        <div className="space-y-2">
                            <h2 className="text-xl font-bold text-white">Connection Lost</h2>
                            <p className="text-sm text-gray-400">
                                The connection to the background process has been interrupted.
                            </p>
                        </div>

                        <button
                            onClick={onReconnect}
                            className="px-6 py-2.5 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors active:scale-95 w-full"
                        >
                            Reconnect
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
