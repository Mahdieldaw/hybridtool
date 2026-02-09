// ResizableSplitLayout.tsx - CSS GRID REFACTOR
// Replaces flexbox with CSS Grid for deterministic layout control
// GRID GUARANTEES: Content cannot expand beyond defined tracks

import React, { useRef, useState, useCallback } from 'react';
import clsx from 'clsx';

interface ResizableSplitLayoutProps {
    leftPane: React.ReactNode;
    rightPane: React.ReactNode;
    isSplitOpen: boolean;
    ratio?: number; // Optional: Initial or controlled percentage (0-100)
    onRatioChange?: (ratio: number) => void;
    minRatio?: number;
    maxRatio?: number;
    dividerContent?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}

export const ResizableSplitLayout: React.FC<ResizableSplitLayoutProps> = ({
    leftPane,
    rightPane,
    isSplitOpen,
    ratio: controlledRatio,
    onRatioChange,
    minRatio = 20,
    maxRatio = 80,
    dividerContent,
    className,
    style
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [internalRatio, setInternalRatio] = useState(controlledRatio ?? 70);
    const [isDragging, setIsDragging] = useState(false);

    // Use controlled ratio if provided, otherwise internal
    const ratio = controlledRatio ?? internalRatio;

    // Calculate grid columns based on split state
    // When closed: single column (100%)
    // When open: left% + divider(6px) + right%
    const gridTemplateColumns = isSplitOpen
        ? `${ratio}fr 6px ${100 - ratio}fr`
        : '1fr';

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        if (!isSplitOpen) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        // Capture pointer to handle moves outside the divider
        (e.target as Element).setPointerCapture(e.pointerId);
    }, [isSplitOpen]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!isDragging || !containerRef.current) return;
        e.preventDefault();

        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const totalWidth = rect.width;

        let newRatio = (x / totalWidth) * 100;

        // Clamp ratio
        newRatio = Math.max(minRatio, Math.min(maxRatio, newRatio));

        if (onRatioChange) {
            onRatioChange(newRatio);
        } else {
            setInternalRatio(newRatio);
        }
    }, [isDragging, minRatio, maxRatio, onRatioChange]);

    const handlePointerUp = useCallback((e: React.PointerEvent) => {
        if (!isDragging) return;
        e.preventDefault();
        setIsDragging(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        (e.target as Element).releasePointerCapture(e.pointerId);
    }, [isDragging]);

    return (
        <div
            ref={containerRef}
            className={clsx("h-full w-full overflow-hidden", className)}
            style={{
                ...style,
                display: 'grid',
                gridTemplateColumns,
                transition: isDragging ? 'none' : 'grid-template-columns 75ms ease-out',
            }}
        >
            {/* ============================================
                LEFT PANE - GRID CELL 1
                ============================================
                Grid cell properties:
                - min-width: 0 (allow shrinking below content)
                - overflow: hidden (clip overflowing content)
                - Grid automatically constrains to track size
                ============================================ */}
            <div
                className="h-full min-w-0 overflow-hidden"
                style={{
                    gridColumn: '1',
                }}
            >
                {leftPane}
            </div>

            {/* ============================================
                DIVIDER + RIGHT PANE (only if split open)
                ============================================ */}
            {isSplitOpen && (
                <>
                    {/* DIVIDER - GRID CELL 2 (6px track) */}
                    <div
                        className="h-full bg-border-subtle hover:bg-brand-500/50 transition-colors cursor-col-resize relative select-none touch-none"
                        style={{
                            gridColumn: '2',
                        }}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                    >
                        {/* Divider Content (Orbs) */}
                        <div
                            className="absolute top-0 bottom-0 left-0 w-0 flex flex-col items-center justify-center overflow-visible pointer-events-none"
                        >
                            <div className="pointer-events-auto transform -translate-x-[calc(100%+6px)]">
                                {dividerContent}
                            </div>
                        </div>
                    </div>

                    {/* ============================================
                        RIGHT PANE - GRID CELL 3
                        ============================================
                        CRITICAL GRID PROPERTIES:
                        - Grid track is explicitly sized (${100-ratio}fr)
                        - min-width: 0 forces content to respect track
                        - overflow: hidden clips anything exceeding track
                        - Content CANNOT expand the grid track
                        
                        This is the key difference from flexbox:
                        Flexbox: Content can expand parent
                        Grid: Parent size is fixed, content must fit
                        ============================================ */}
                    <div
                        className="h-full min-w-0 overflow-hidden"
                        style={{
                            gridColumn: '3',
                        }}
                    >
                        {rightPane}
                    </div>
                </>
            )}
        </div>
    );
};

// ============================================
// ARCHITECTURAL ANALYSIS: GRID VS FLEXBOX
// ============================================
//
// FLEXBOX BEHAVIOR (what we had):
// ┌─────────────────────────────────────────┐
// │ Container (display: flex)               │
// │ ┌───────────┐ ┌────────────────────┐   │
// │ │ Left      │ │ Right (flex-1)     │   │
// │ │ (70%)     │ │ ↓                  │   │
// │ │           │ │ Content wants      │   │
// │ │           │ │ 2000px width       │   │
// │ │           │ │ ↓                  │   │
// │ │           │ │ EXPANDS! →→→→→→→→→→│→→→(off-screen)
// │ └───────────┘ └────────────────────┘   │
// └─────────────────────────────────────────┘
//
// GRID BEHAVIOR (what we now have):
// ┌─────────────────────────────────────────┐
// │ Container (display: grid)               │
// │ grid-template-columns: 70fr 6px 30fr    │
// │ ┌───────────┐│┌────────────────────┐   │
// │ │ Left      ││┤ Right              │   │
// │ │ [Track 1] ││┤ [Track 3]          │   │
// │ │           ││┤ Content wants      │   │
// │ │           ││┤ 2000px width       │   │
// │ │           ││┤ ↓                  │   │
// │ │           ││┤ CLIPPED! (max 30%) │   │
// │ └───────────┘│└────────────────────┘   │
// └─────────────────────────────────────────┘
//
// KEY INSIGHT:
// Grid tracks are EXPLICIT and IMMUTABLE.
// Content cannot change track size.
// This gives us DETERMINISTIC behavior.
//
// ============================================
// PRODUCTION BENEFITS
// ============================================
//
// 1. DETERMINISTIC LAYOUT
//    - Track sizes are calculated once
//    - Content cannot alter them
//    - No "flexbox negotiation" phase
//
// 2. SIMPLER OVERFLOW HANDLING
//    - Just add min-width: 0 and overflow: hidden
//    - No need for max-width hacks
//    - No fighting with flex-shrink/flex-grow
//
// 3. BETTER PERFORMANCE
//    - Grid layout is faster than flexbox for fixed layouts
//    - Single layout pass vs multiple flex negotiations
//    - Smoother resize animations
//
// 4. EASIER TO REASON ABOUT
//    - "3 columns: left, divider, right"
//    - No implicit flex calculations
//    - Clear mental model
//
// 5. FUTURE-PROOF
//    - Can add more columns/rows trivially
//    - Subgrid support for nested layouts
//    - Better alignment tools
//
// ============================================
// MIGRATION NOTES
// ============================================
//
// This is a DROP-IN REPLACEMENT for the flexbox version.
// - Same props API
// - Same behavior from parent's perspective
// - All child components work unchanged
//
// TESTING CHECKLIST:
// □ Resize handle works smoothly
// □ Long content doesn't break layout
// □ Both panes stay visible
// □ Transitions are smooth
// □ No horizontal scroll on container
// □ Content scrolls within panes
//
// ============================================