import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3-force';
import {
    Claim, Edge, ProblemStructure, EnrichedClaim,
} from '../../shared/contract';

const DEBUG_DECISION_MAP_GRAPH = false;
const decisionMapGraphDbg = (...args: any[]) => {
    if (DEBUG_DECISION_MAP_GRAPH) console.debug('[DecisionMapGraph]', ...args);
};

// Internal node type for d3 simulation, extending V3 Claim
export interface GraphNode extends d3.SimulationNodeDatum {
    id: string; // V3 claim id
    label: string;
    text: string;
    supporters: (string | number)[]; // V3 numbers or legacy strings
    support_count: number;
    type: Claim['type'];
    role: Claim['role'];
    // D3 state
    x?: number;
    y?: number;
    fx?: number | null;
    fy?: number | null;
    vx?: number;
    vy?: number;
}

export interface GraphEdge extends d3.SimulationLinkDatum<GraphNode> {
    source: string | GraphNode;
    target: string | GraphNode;
    type: string; // V3 edge type
    reason?: string;
}

interface Props {
    claims: Claim[];
    edges: Edge[];
    problemStructure?: ProblemStructure;
    enrichedClaims?: EnrichedClaim[];
    citationSourceOrder?: Record<number, string>;
    onNodeClick?: (node: GraphNode) => void;
    selectedClaimIds?: string[];
    width?: number;
    height?: number;
}

function getRoleColor(role: Claim['role']): string {
    switch (role) {
        case 'anchor':
            return '#3b82f6';
        case 'branch':
            return '#10b981';
        case 'challenger':
            return '#f59e0b';
        case 'supplement':
            return '#6b7280';
        default:
            return '#8b5cf6';
    }
}

// Node sizing by support_count: 1=48px diameter (24 radius), 2=64px (32 radius), 3+=80px (40 radius)
function getNodeRadius(supportCount: number): number {
    const base = 20;
    const scale = 8;
    return base + Math.max(1, supportCount) * scale;
}

// Simple connected-components for parallel layout
function buildSimpleComponents(nodeIds: string[], edges: Edge[]): string[][] {
    const neighbors = new Map<string, Set<string>>();
    for (const id of nodeIds) neighbors.set(id, new Set());
    for (const e of edges) {
        if (!neighbors.has(e.from) || !neighbors.has(e.to)) continue;
        neighbors.get(e.from)!.add(e.to);
        neighbors.get(e.to)!.add(e.from);
    }
    const visited = new Set<string>();
    const components: string[][] = [];
    for (const id of nodeIds) {
        if (visited.has(id)) continue;
        const stack = [id];
        const comp: string[] = [];
        visited.add(id);
        while (stack.length) {
            const cur = stack.pop()!;
            comp.push(cur);
            for (const nxt of neighbors.get(cur) ?? []) {
                if (visited.has(nxt)) continue;
                visited.add(nxt);
                stack.push(nxt);
            }
        }
        components.push(comp);
    }
    return components.sort((a, b) => b.length - a.length);
}

// Helper logic moved inside component with O(1) lookups

const DecisionMapGraph: React.FC<Props> = ({
    claims: inputClaims,
    edges: inputEdges,
    problemStructure,
    enrichedClaims,
    citationSourceOrder: _citationSourceOrder,
    onNodeClick,
    selectedClaimIds,
    width = 400,
    height = 250,
}) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);
    const [nodes, setNodes] = useState<GraphNode[]>([]);
    const [edges, setEdges] = useState<GraphEdge[]>([]);
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);
    const [hoveredEdge, setHoveredEdge] = useState<{ edge: GraphEdge; x: number; y: number } | null>(null);

    // Zoom/pan state
    const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0 });

    // ...

    // OPTIMIZATION: Precompute lookups for O(1) access
    const lookups = React.useMemo(() => {
        const peakSet = new Set<string>();
        const dissentSet = new Set<string>();
        const fragileSet = new Set<string>();
        const keystoneSet = new Set<string>();
        const chainMap = new Map<string, number>();

        return { peakSet, dissentSet, fragileSet, keystoneSet, chainMap };
    }, []);

    useEffect(() => {
        if (!inputClaims.length) {
            setNodes([]);
            setEdges([]);
            return;
        }

        const existingPositions = new Map(
            nodes.map(n => [n.id, { x: n.x, y: n.y }])
        );

        const nodeIds = inputClaims.map((c) => c.id);
        const targets = new Map<string, { x: number; y: number }>();

        const padding = 60;
        const usableW = Math.max(1, width - padding * 2);
        const usableH = Math.max(1, height - padding * 2);

        // Layout based on PRIMARY SHAPE
        const primaryShape = problemStructure?.primary;
        let layoutMode: 'convergent' | 'forked' | 'constrained' | 'parallel' | 'force' = 'force';

        // Determine Layout Mode
        if (primaryShape === 'convergent') {
            layoutMode = 'convergent';
        } else if (primaryShape === 'forked') {
            layoutMode = 'forked';
        } else if (primaryShape === 'constrained') {
            layoutMode = 'constrained';
        } else if (primaryShape === 'parallel') {
            layoutMode = 'parallel';
        }

        if (layoutMode === 'convergent') {
            // CONVERGENT - tight cluster in center
            const centerX = width / 2;
            const centerY = height / 2;
            const radius = Math.min(usableW, usableH) * 0.25;

            // Peaks go in inner ring
            const peaks = nodeIds.filter(id => lookups.peakSet.has(id));
            const others = nodeIds.filter(id => !lookups.peakSet.has(id));

            peaks.forEach((id, idx) => {
                const angle = (idx / peaks.length) * Math.PI * 2;
                targets.set(id, {
                    x: centerX + Math.cos(angle) * radius * 0.3,
                    y: centerY + Math.sin(angle) * radius * 0.3,
                });
            });

            others.forEach((id, idx) => {
                const angle = (idx / others.length) * Math.PI * 2;
                targets.set(id, {
                    x: centerX + Math.cos(angle) * radius * 0.8,
                    y: centerY + Math.sin(angle) * radius * 0.8,
                });
            });
        } else if (layoutMode === 'forked') {
            // FORKED - two clusters on opposite sides
            const peaks = [...nodeIds];
            const leftPeaks = peaks.slice(0, Math.ceil(peaks.length / 2));
            const rightPeaks = peaks.slice(Math.ceil(peaks.length / 2));

            leftPeaks.forEach((id: string, idx: number) => {
                targets.set(id, {
                    x: width * 0.25,
                    y: height / 2 + (idx - leftPeaks.length / 2) * 60,
                });
            });

            rightPeaks.forEach((id: string, idx: number) => {
                targets.set(id, {
                    x: width * 0.75,
                    y: height / 2 + (idx - rightPeaks.length / 2) * 60,
                });
            });
        } else if (layoutMode === 'constrained') {
            // CONSTRAINED - horizontal spread showing tradeoff
            const peaks = [...nodeIds];
            const spacing = usableW / (peaks.length + 1);

            peaks.forEach((id: string, idx: number) => {
                targets.set(id, {
                    x: padding + spacing * (idx + 1),
                    y: height / 2,
                });
            });
        } else if (layoutMode === 'parallel') {
            // PARALLEL - separate clusters for each connected component
            const components = buildSimpleComponents(nodeIds, inputEdges);
            const colWidth = usableW / components.length;

            components.forEach((comp, compIdx) => {
                const compCenterX = padding + colWidth * (compIdx + 0.5);
                comp.forEach((id, idx) => {
                    targets.set(id, {
                        x: compCenterX,
                        y: padding + (idx / Math.max(1, comp.length - 1)) * usableH,
                    });
                });
            });
        }
        // SPARSE - no targets, let simulation find equilibrium

        // Map V3 Claims to GraphNodes
        const simNodes: GraphNode[] = inputClaims.map(c => {
            const existing = existingPositions.get(c.id);
            const supporters = Array.isArray(c.supporters) ? c.supporters : [];
            const supportCount = (typeof c.support_count === 'number' && c.support_count > 0) ? c.support_count : (supporters.length || 1);
            const target = targets.get(c.id);
            return {
                id: c.id,
                label: c.label,
                text: c.text,
                supporters,
                support_count: supportCount,
                type: c.type,
                role: c.role,
                x: existing?.x ?? target?.x ?? width / 2 + (Math.random() - 0.5) * 100,
                y: existing?.y ?? target?.y ?? height / 2 + (Math.random() - 0.5) * 100,
            };
        });

        // Map V3 Edges to GraphEdges, filtering out any edges pointing to missing nodes
        const validNodeIds = new Set(simNodes.map(n => n.id));
        const simEdges: GraphEdge[] = inputEdges
            .filter(e => validNodeIds.has(e.from) && validNodeIds.has(e.to))
            .map(e => ({
                source: e.from,
                target: e.to,
                type: e.type,
                reason: e.type // Use type as reason for now or logic from meta
            }));

        decisionMapGraphDbg("init", {
            claims: inputClaims.length,
            edges: inputEdges.length,
            pattern: problemStructure?.primary || null,
            confidence: problemStructure?.confidence ?? null,
            targets: targets.size,
            layoutMode
        });

        // Stop existing simulation
        if (simulationRef.current) {
            simulationRef.current.stop();
        }

        // Create new simulation with SEMANTIC forces - SPREAD OUT LAYOUT
        const aspectRatio = width / height;
        const isWideLayout = aspectRatio > 1.5;
        const nodePadding = 80; // Keep nodes away from edges (increased for larger spread)

        const simulation = d3.forceSimulation<GraphNode>(simNodes)
            .force('charge', d3.forceManyBody().strength(-1000))
            .force('link', d3.forceLink<GraphNode, GraphEdge>(simEdges)
                .id(d => d.id)
                .distance(link => {
                    const baseDist = link.type === 'supports' ? 120 :
                        link.type === 'conflicts' ? 220 :
                            link.type === 'tradeoff' ? 180 :
                                120;
                    return isWideLayout ? baseDist * 1.6 : baseDist; // Increased distance
                })
                .strength(link => {
                    if (link.type === 'supports') return 0.45;
                    if (link.type === 'conflicts') return 0.15;
                    if (link.type === 'tradeoff') return 0.22;
                    return 0.28;
                }))
            .force('center', d3.forceCenter(width / 2, height / 2).strength(0.01)) // Extremely weak centering
            .force('collision', d3.forceCollide<GraphNode>().radius(d => getNodeRadius(d.support_count) + 45)) // Large collision radius for labels
            // No x-centering force - let nodes spread horizontally
            .force('y', d3.forceY(height / 2).strength(0.02)) // Very weak vertical centering
            // Soft boundary force to keep nodes inside canvas
            .force('boundary', () => {
                simNodes.forEach(node => {
                    const r = getNodeRadius(node.support_count);
                    if (node.x !== undefined) {
                        if (node.x < nodePadding + r) {
                            node.vx = (node.vx || 0) + 1.5;
                        } else if (node.x > width - nodePadding - r) {
                            node.vx = (node.vx || 0) - 1.5;
                        }
                    }
                    if (node.y !== undefined) {
                        if (node.y < nodePadding + r) {
                            node.vy = (node.vy || 0) + 1.5;
                        } else if (node.y > height - nodePadding - r) {
                            node.vy = (node.vy || 0) - 1.5;
                        }
                    }
                });
            })
            .alphaDecay(0.02);

        // Apply target positions if layout has set them
        if (targets.size > 0) {
            simulation.force('xTarget', d3.forceX<GraphNode>(d => (targets.get(d.id)?.x ?? width / 2)).strength(0.1));
            simulation.force('yTarget', d3.forceY<GraphNode>(d => (targets.get(d.id)?.y ?? height / 2)).strength(0.1));
        } else {
            simulation.force('xTarget', null);
            simulation.force('yTarget', null);
        }

        simulation.on('tick', () => {
            setNodes([...simNodes]);
            setEdges([...simEdges]);
        });

        simulationRef.current = simulation;

        return () => {
            simulation.stop();
        };
    }, [inputClaims, inputEdges, width, height, problemStructure, lookups]);

    // Get edge coordinates
    const getEdgeCoords = useCallback((edge: GraphEdge) => {
        const source = typeof edge.source === 'object'
            ? edge.source as GraphNode
            : nodes.find(n => n.id === edge.source);
        const target = typeof edge.target === 'object'
            ? edge.target as GraphNode
            : nodes.find(n => n.id === edge.target);

        if (source?.x == null || source?.y == null || target?.x == null || target?.y == null) return null;

        return { x1: source.x, y1: source.y, x2: target.x, y2: target.y };
    }, [nodes]);

    // Drag handlers
    const handleDragStart = useCallback((nodeId: string) => {
        if (simulationRef.current) {
            simulationRef.current.alphaTarget(0.3).restart();
        }
        setNodes(prev => prev.map(n =>
            n.id === nodeId ? { ...n, fx: n.x, fy: n.y } : n
        ));
    }, []);

    const handleDrag = useCallback((nodeId: string, x: number, y: number) => {
        // Account for transform when dragging
        const adjustedX = (x - transform.x) / transform.scale;
        const adjustedY = (y - transform.y) / transform.scale;
        setNodes(prev => prev.map(n =>
            n.id === nodeId ? { ...n, fx: adjustedX, fy: adjustedY, x: adjustedX, y: adjustedY } : n
        ));
    }, [transform]);

    const handleDragEnd = useCallback((nodeId: string) => {
        if (simulationRef.current) {
            simulationRef.current.alphaTarget(0);
        }
        setNodes(prev => prev.map(n =>
            n.id === nodeId ? { ...n, fx: null, fy: null } : n
        ));
    }, []);


    // Mouse handlers for SVG
    const dragState = useRef<{ nodeId: string | null; startX: number; startY: number }>({
        nodeId: null, startX: 0, startY: 0
    });

    const handleMouseDown = (nodeId: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const svg = svgRef.current;
        if (!svg) return;

        const rect = svg.getBoundingClientRect();
        dragState.current = {
            nodeId,
            startX: e.clientX - rect.left,
            startY: e.clientY - rect.top,
        };
        handleDragStart(nodeId);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!svgRef.current) return;

        // Handle node dragging
        if (dragState.current.nodeId) {
            const rect = svgRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            handleDrag(dragState.current.nodeId, x, y);
            return;
        }

        // Handle panning
        if (isPanningRef.current) {
            const dx = e.clientX - panStartRef.current.x;
            const dy = e.clientY - panStartRef.current.y;
            setTransform(prev => ({
                ...prev,
                x: prev.x + dx,
                y: prev.y + dy
            }));
            panStartRef.current = { x: e.clientX, y: e.clientY };
        }
    };

    const handleMouseUp = () => {
        if (dragState.current.nodeId) {
            handleDragEnd(dragState.current.nodeId);
            dragState.current.nodeId = null;
        }
        isPanningRef.current = false;
    };

    // Pan on background drag
    const handleBackgroundMouseDown = (e: React.MouseEvent) => {
        if ((e.target as Element).classList.contains('graph-background')) {
            isPanningRef.current = true;
            panStartRef.current = { x: e.clientX, y: e.clientY };
        }
    };

    // Zoom with scroll wheel
    const handleWheel = useCallback((e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation(); // Good practice to stop bubbling

        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(0.5, Math.min(2, transform.scale * delta));

        const rect = svgRef.current?.getBoundingClientRect();
        if (rect) {
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const newX = mouseX - (mouseX - transform.x) * (newScale / transform.scale);
            const newY = mouseY - (mouseY - transform.y) * (newScale / transform.scale);

            setTransform({ x: newX, y: newY, scale: newScale });
        }
    }, [transform]);

    // 2. Add this useEffect to attach the non-passive listener
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;

        // { passive: false } is the key fix here
        svg.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            svg.removeEventListener('wheel', handleWheel);
        };
    }, [handleWheel]);

    if (!nodes.length) {
        return (
            <div
                style={{
                    width,
                    height,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    borderRadius: 12,
                }}
            >
                <div style={{
                    color: 'rgba(167,139,250,0.7)',
                    fontSize: 13,
                    fontWeight: 500,
                    textAlign: 'center',
                }}>
                    No claims visualized
                </div>
            </div>
        );
    }

    return (
        <svg
            ref={svgRef}
            width={width}
            height={height}
            style={{
                background: 'transparent',
                borderRadius: 12,
                cursor: isPanningRef.current ? 'grabbing' : (dragState.current.nodeId ? 'grabbing' : 'grab'),
            }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onMouseDown={handleBackgroundMouseDown}
        >
            <defs>
                {/* Enhanced glow filters */}
                <filter id="edgeGlowGreen" x="-150%" y="-150%" width="400%" height="400%">
                    <feGaussianBlur stdDeviation="6" result="blur" />
                    <feFlood floodColor="#10b981" floodOpacity="0.6" />
                    <feComposite in2="blur" operator="in" result="glow" />
                    <feMerge>
                        <feMergeNode in="glow" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>

                <filter id="edgeGlowRed" x="-150%" y="-150%" width="400%" height="400%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feFlood floodColor="#ef4444" floodOpacity="0.5" />
                    <feComposite in2="blur" operator="in" result="glow" />
                    <feMerge>
                        <feMergeNode in="glow" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>

                <filter id="edgeGlowOrange" x="-150%" y="-150%" width="400%" height="400%">
                    <feGaussianBlur stdDeviation="5" result="blur" />
                    <feFlood floodColor="#f97316" floodOpacity="0.75" />
                    <feComposite in2="blur" operator="in" result="glow" />
                    <feMerge>
                        <feMergeNode in="glow" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>

                <marker id="arrowGray" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" />
                </marker>
                <marker id="arrowRed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                </marker>
                <marker id="arrowOrange" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#f97316" />
                </marker>

                <filter id="nodeGlow" x="-200%" y="-200%" width="500%" height="500%">
                    <feGaussianBlur stdDeviation="8" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
            </defs>

            {/* Background for panning */}
            <rect
                className="graph-background"
                width="100%"
                height="100%"
                fill="transparent"
            />

            {/* Transform group for zoom/pan */}
            <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
                {/* Edges with enhanced visuals */}
                <g className="edges">
                    {edges.map((edge, i) => {
                        const coords = getEdgeCoords(edge);
                        if (!coords) return null;

                        const baseColor =
                            edge.type === 'supports' ? '#9ca3af' :
                                edge.type === 'conflicts' ? '#ef4444' :
                                    edge.type === 'tradeoff' ? '#f97316' :
                                        '#9ca3af';
                        const dash =
                            edge.type === 'conflicts' ? '6,4' :
                                edge.type === 'tradeoff' ? '2,2' :
                                    undefined;
                        const markerEnd =
                            edge.type === 'supports' ? 'url(#arrowGray)' :
                                edge.type === 'conflicts' ? 'url(#arrowRed)' :
                                    edge.type === 'tradeoff' ? 'url(#arrowOrange)' :
                                        undefined;
                        const markerStart =
                            edge.type === 'conflicts' ? 'url(#arrowRed)' :
                                edge.type === 'tradeoff' ? 'url(#arrowOrange)' :
                                    undefined;
                        const midX = (coords.x1 + coords.x2) / 2;
                        const midY = (coords.y1 + coords.y2) / 2;

                        return (
                            <g key={`edge-${i}`}>
                                {/* Wide glow layer */}
                                <line
                                    x1={coords.x1}
                                    y1={coords.y1}
                                    x2={coords.x2}
                                    y2={coords.y2}
                                    stroke={baseColor}
                                    strokeWidth={12}
                                    strokeOpacity={0.12}
                                />
                                {/* Main line with filter */}
                                <line
                                    x1={coords.x1}
                                    y1={coords.y1}
                                    x2={coords.x2}
                                    y2={coords.y2}
                                    stroke={baseColor}
                                    strokeWidth={2.5}
                                    strokeDasharray={dash}
                                    markerStart={markerStart}
                                    markerEnd={markerEnd}
                                    filter={
                                        edge.type === 'conflicts' ? 'url(#edgeGlowRed)' :
                                            edge.type === 'tradeoff' ? 'url(#edgeGlowOrange)' :
                                                undefined
                                    }
                                    style={{
                                        animation: edge.type === 'conflicts' ? 'conflictPulse 2s ease-in-out infinite' : undefined
                                    }}
                                >
                                    {edge.type === 'conflicts' && (
                                        <animate
                                            attributeName="stroke-opacity"
                                            values="0.4;0.8;0.4"
                                            dur="2s"
                                            repeatCount="indefinite"
                                        />
                                    )}
                                </line>
                                {/* Invisible wider hit area for hover */}
                                <line
                                    x1={coords.x1}
                                    y1={coords.y1}
                                    x2={coords.x2}
                                    y2={coords.y2}
                                    stroke="transparent"
                                    strokeWidth={20}
                                    style={{ cursor: 'pointer' }}
                                    onMouseEnter={() => setHoveredEdge({ edge, x: midX, y: midY })}
                                    onMouseLeave={() => setHoveredEdge(null)}
                                />
                            </g>
                        );
                    })}
                </g>


                {/* Nodes with premium styling */}
                <g className="nodes">
                    {nodes.map(node => {
                        const x = node.x || 0;
                        const y = node.y || 0;
                        const radius = getNodeRadius(node.support_count);
                        const isHovered = hoveredNode === node.id;

                        // Find enriched data for this node
                        const enriched = enrichedClaims?.find(c => c.id === node.id);

                        // NEW: Get patterns for this claim
                        // Use O(1) lookups
                        const isPeak = lookups.peakSet.has(node.id);
                        const isKeystone = lookups.keystoneSet.has(node.id);
                        const isDissent = lookups.dissentSet.has(node.id);
                        const isFragile = lookups.fragileSet.has(node.id);
                        const chainPosition = lookups.chainMap.get(node.id) ?? null;

                        // Determine color based on patterns (priority order)
                        const color =
                            isKeystone ? '#8b5cf6' :          // Purple for keystone
                                isDissent ? '#fbbf24' :           // Yellow/amber for dissent
                                    isFragile ? '#f97316' :           // Orange for fragile
                                        isPeak ? '#3b82f6' :              // Blue for peaks
                                            enriched?.isChallenger ? '#f59e0b' :
                                                    enriched?.isHighSupport ? '#10b981' :
                                                        getRoleColor(node.role);

                        const isSelected = Array.isArray(selectedClaimIds) && selectedClaimIds.includes(node.id);
                        const showWarning = isFragile;

                        return (
                            <g
                                key={node.id}
                                transform={`translate(${x}, ${y})`}
                                style={{ cursor: 'pointer' }}
                                onMouseDown={(e) => handleMouseDown(node.id, e)}
                                onMouseEnter={() => setHoveredNode(node.id)}
                                onMouseLeave={() => setHoveredNode(null)}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onNodeClick?.(node);
                                }}
                            >
                                {/* Hover aura */}
                                {isHovered && (
                                    <circle r={radius + 16} fill={color} opacity={0.25} filter="url(#nodeGlow)">
                                        <animate attributeName="opacity" values="0.25;0.4;0.25" dur="1.5s" repeatCount="indefinite" />
                                    </circle>
                                )}

                                {isSelected && (
                                    <circle r={radius + 10} fill="none" stroke={color} strokeWidth={3} strokeOpacity={0.9} />
                                )}

                                {/* Outer ring */}
                                {node.role !== 'challenger' ? (
                                    <circle
                                        r={radius + 3}
                                        fill="none"
                                        stroke={color}
                                        strokeWidth={isHovered ? 2.5 : 1.5}
                                        strokeOpacity={0.5}
                                    />
                                ) : (
                                    <polygon
                                        points={`${0},${-(radius + 3)} ${radius + 3},0 0,${radius + 3} ${-(radius + 3)},0`}
                                        fill="none"
                                        stroke={color}
                                        strokeWidth={isHovered ? 2.5 : 1.5}
                                        strokeOpacity={0.5}
                                    />
                                )}

                                {/* Radial gradient definition */}
                                <defs>
                                    <radialGradient id={`nodeGrad-${node.id}`} cx="30%" cy="30%">
                                        <stop offset="0%" stopColor={`${color}cc`} />
                                        <stop offset="60%" stopColor={color} />
                                        <stop offset="100%" stopColor={`${color}88`} />
                                    </radialGradient>
                                </defs>

                                {/* Main node */}
                                {node.role !== 'challenger' ? (
                                    <circle
                                        r={radius}
                                        fill={`url(#nodeGrad-${node.id})`}
                                        stroke={color}
                                        strokeWidth={isHovered ? 3 : 2}
                                        filter="url(#nodeGlow)"
                                    />
                                ) : (
                                    <polygon
                                        points={`${0},${-radius} ${radius},0 0,${radius} ${-radius},0`}
                                        fill={`url(#nodeGrad-${node.id})`}
                                        stroke={color}
                                        strokeWidth={isHovered ? 3 : 2}
                                        filter="url(#nodeGlow)"
                                    />
                                )}

                                {/* Highlight sparkle */}
                                <circle
                                    cx={-radius * 0.35}
                                    cy={-radius * 0.35}
                                    r={radius * 0.2}
                                    fill="rgba(255,255,255,0.5)"
                                    opacity={isHovered ? 0.7 : 0.4}
                                />

                                {/* NEW: Dissent indicator (⚡) */}
                                {isDissent && (
                                    <text
                                        y={-radius - 8}
                                        textAnchor="middle"
                                        fontSize={16}
                                        style={{ filter: 'drop-shadow(0 0 4px rgba(251, 191, 36, 0.8))' }}
                                    >
                                        ⚡
                                    </text>
                                )}

                                {/* Keystone crown indicator */}
                                {isKeystone && !isDissent && (
                                    <text
                                        y={-radius - 8}
                                        textAnchor="middle"
                                        fontSize={14}
                                    >
                                        👑
                                    </text>
                                )}

                                {/* Peak indicator (star) */}
                                {isPeak && !isKeystone && !isDissent && (
                                    <text
                                        y={-radius - 8}
                                        textAnchor="middle"
                                        fontSize={12}
                                        fill="#3b82f6"
                                    >
                                        ★
                                    </text>
                                )}

                                {/* NEW: Fragile indicator */}
                                {isFragile && (
                                    <g transform={`translate(${radius * 0.6}, ${-radius * 0.6})`}>
                                        <circle r={8} fill="#f97316" stroke="#fff" strokeWidth={1} />
                                        <text
                                            textAnchor="middle"
                                            dy={4}
                                            fill="#fff"
                                            fontSize={10}
                                            fontWeight="bold"
                                        >
                                            ~
                                        </text>
                                    </g>
                                )}

                                {/* Chain position indicator */}
                                {chainPosition !== null && (
                                    <text
                                        y={radius + 24}
                                        textAnchor="middle"
                                        fill="rgba(59, 130, 246, 0.8)"
                                        fontSize={10}
                                        fontWeight="bold"
                                    >
                                        Step {chainPosition + 1}
                                    </text>
                                )}

                                {/* Warning indicator for evidence gaps / leverage inversions */}
                                {showWarning && !isFragile && (
                                    <g transform={`translate(${-radius * 0.6}, ${-radius * 0.6})`}>
                                        <circle r={8} fill="#ef4444" stroke="#fff" strokeWidth={1} />
                                        <text
                                            textAnchor="middle"
                                            dy={4}
                                            fill="#fff"
                                            fontSize={10}
                                            fontWeight="bold"
                                        >
                                            !
                                        </text>
                                    </g>
                                )}

                                {/* Support count badge */}
                                {node.support_count > 1 && (
                                    <g>
                                        <circle
                                            cx={radius * 0.6}
                                            cy={-radius * 0.6}
                                            r={10}
                                            fill="rgba(0,0,0,0.8)"
                                            stroke={color}
                                            strokeWidth={1.5}
                                        />
                                        <text
                                            x={radius * 0.6}
                                            y={-radius * 0.6 + 4}
                                            textAnchor="middle"
                                            fill="white"
                                            fontSize={10}
                                            fontWeight="bold"
                                            style={{ pointerEvents: 'none' }}
                                        >
                                            {node.support_count}
                                        </text>
                                    </g>
                                )}
                            </g>
                        );
                    })}
                </g>

                {/* Labels - rendered after nodes to ensure z-index priority */}
                <g className="labels" style={{ pointerEvents: 'none' }}>
                    {nodes.map(node => {
                        const x = node.x || 0;
                        const y = node.y || 0;
                        const radius = getNodeRadius(node.support_count);
                        const isHovered = hoveredNode === node.id;

                        // Show for larger nodes always, others on hover
                        if (!isHovered && node.support_count < 2) return null;

                        return (
                            <g
                                key={`label-${node.id}`}
                                transform={`translate(${x}, ${y})`}
                            >
                                <foreignObject
                                    x={-90}
                                    y={radius + 8}
                                    width={180}
                                    height={50}
                                    style={{ overflow: 'visible' }}
                                >
                                    <div
                                        style={{
                                            padding: '4px 8px',
                                            fontSize: 11,
                                            fontWeight: 600,
                                            color: 'rgba(255,255,255,0.95)',
                                            textAlign: 'center',
                                            wordWrap: 'break-word',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            display: '-webkit-box',
                                            WebkitLineClamp: 3,
                                            WebkitBoxOrient: 'vertical',
                                            lineHeight: 1.3,
                                            textShadow: '0 2px 4px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,1)'
                                        }}
                                    >
                                        {node.label}
                                    </div>
                                </foreignObject>
                            </g>
                        );
                    })}
                </g>

                {/* Edge reason tooltip - rendered last so it's on top */}
                {hoveredEdge && hoveredEdge.edge.reason && (
                    <g transform={`translate(${hoveredEdge.x}, ${hoveredEdge.y})`} style={{ pointerEvents: 'none' }}>
                        <foreignObject
                            x={-150}
                            y={-40}
                            width={300}
                            height={100}
                            style={{ overflow: 'visible' }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', height: '100%', paddingBottom: 12 }}>
                                <div
                                    style={{
                                        background: 'rgba(0,0,0,0.95)',
                        border: `1px solid ${hoveredEdge.edge.type === 'supports' ? '#9ca3af' : hoveredEdge.edge.type === 'conflicts' ? '#ef4444' : hoveredEdge.edge.type === 'tradeoff' ? '#f97316' : '#9ca3af'}`,
                                        borderRadius: 6,
                                        padding: '6px 10px',
                                        fontSize: 11,
                                        fontWeight: 500,
                                        color: 'rgba(255,255,255,0.95)',
                                        textAlign: 'center',
                                        boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
                                        maxWidth: '100%'
                                    }}
                                >
                                    {hoveredEdge.edge.reason}
                                </div>
                            </div>
                        </foreignObject>
                    </g>
                )}
            </g>

            {/* Legend - fixed position outside transform */}
            {/* Legend - updated for new model */}
            <g transform={`translate(${width - 160}, 20)`}>
                <rect x={-10} y={-10} width={155} height={132} fill="rgba(0,0,0,0.85)" rx={8} stroke="rgba(139,92,246,0.3)" strokeWidth={1} />
                <text x={0} y={8} fill="rgba(255,255,255,0.8)" fontSize={10} fontWeight={600}>Legend</text>

                {/* Edges */}
                <line x1={0} y1={24} x2={30} y2={24} stroke="#9ca3af" strokeWidth={2.5} markerEnd="url(#arrowGray)" />
                <text x={38} y={28} fill="rgba(255,255,255,0.7)" fontSize={9}>Supports</text>

                <line x1={0} y1={42} x2={30} y2={42} stroke="#f97316" strokeWidth={2.5} strokeDasharray="2,2" />
                <text x={38} y={46} fill="rgba(255,255,255,0.7)" fontSize={9}>Tradeoff</text>

                <line x1={0} y1={60} x2={30} y2={60} stroke="#ef4444" strokeWidth={2.5} strokeDasharray="6,4" />
                <text x={38} y={64} fill="rgba(255,255,255,0.7)" fontSize={9}>Conflicts</text>

                {/* Node indicators */}
                <text x={0} y={82} fill="rgba(255,255,255,0.6)" fontSize={8}>NODE INDICATORS</text>

                <text x={0} y={98} fontSize={12}>👑</text>
                <text x={18} y={98} fill="rgba(255,255,255,0.7)" fontSize={9}>Keystone</text>

                <text x={70} y={98} fontSize={12}>⚡</text>
                <text x={88} y={98} fill="rgba(255,255,255,0.7)" fontSize={9}>Dissent</text>

                <text x={0} y={116} fontSize={10}>★</text>
                <text x={18} y={116} fill="rgba(255,255,255,0.7)" fontSize={9}>Peak</text>

                <circle cx={78} cy={112} r={6} fill="#f97316" />
                <text x={88} y={116} fill="rgba(255,255,255,0.7)" fontSize={9}>Fragile</text>
            </g>
        </svg>
    );
};

export default DecisionMapGraph;
