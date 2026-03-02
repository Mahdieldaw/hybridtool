import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3-force';
import {
    Claim,
    Edge,
    ProblemStructure,
    DissentPatternData,
    KeystonePatternData,
    ChainPatternData,
    FragilePatternData,
} from '../../shared/contract';

const DEBUG_DECISION_MAP_GRAPH = false;
const decisionMapGraphDbg = (...args: any[]) => {
    if (DEBUG_DECISION_MAP_GRAPH) console.debug('[DecisionMapGraph]', ...args);
};

const REGION_COLORS = ["#34d399", "#60a5fa", "#fbbf24", "#fb7185", "#a78bfa", "#22d3ee", "#f472b6", "#c084fc", "#f97316", "#4ade80"];

// Internal node type for d3 simulation, extending V3 Claim
export interface GraphNode extends d3.SimulationNodeDatum {
    id: string; // V3 claim id
    label: string;
    text: string;
    supporters: (string | number)[]; // V3 numbers or legacy strings
    support_count: number;
    provenanceBulk?: number | null;
    sourceRegionIds?: string[];
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
    onNodeClick?: (node: GraphNode) => void;
    selectedClaimIds?: string[];
    width?: number;
    height?: number;
}

function getNodeRadius(node: GraphNode): number {
    const bulk = typeof node.provenanceBulk === 'number' && Number.isFinite(node.provenanceBulk) ? node.provenanceBulk : null;
    if (bulk != null) {
        return Math.max(12, Math.min(34, 12 + Math.sqrt(Math.max(0, bulk)) * 10));
    }
    const base = 14;
    const scale = 5;
    return Math.max(12, Math.min(30, base + Math.max(1, node.support_count) * scale));
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
        const peakSet = new Set(problemStructure?.peaks?.map(p => p.id));
        const dissentSet = new Set<string>();
        const fragileSet = new Set<string>();
        const keystoneSet = new Set<string>();
        const chainMap = new Map<string, number>();

        problemStructure?.patterns?.forEach(p => {
            if (p.type === 'dissent') {
                const data = p.data as DissentPatternData;
                if (data.strongestVoice) dissentSet.add(data.strongestVoice.id);
                data.voices.forEach(v => dissentSet.add(v.id));
            } else if (p.type === 'keystone') {
                const data = p.data as KeystonePatternData;
                keystoneSet.add(data.keystone.id);
            } else if (p.type === 'chain') {
                const data = p.data as ChainPatternData;
                data.chain.forEach((id, idx) => chainMap.set(id, idx));
            } else if (p.type === 'fragile') {
                const data = p.data as FragilePatternData;
                data.fragilities.forEach(f => fragileSet.add(f.peak.id));
            }
        });

        return { peakSet, dissentSet, fragileSet, keystoneSet, chainMap };
    }, [problemStructure]);

    const componentGroups = React.useMemo(() => {
        const ids = inputClaims.map(c => c.id);
        if (ids.length === 0) return [];
        return buildSimpleComponents(ids, inputEdges);
    }, [inputClaims, inputEdges]);

    const regionColorById = React.useMemo(() => {
        const ids = new Set<string>();
        for (const c of inputClaims as any[]) {
            const rids = Array.isArray(c?.sourceRegionIds) ? c.sourceRegionIds : [];
            for (const rid of rids) {
                const id = String(rid ?? '').trim();
                if (id) ids.add(id);
            }
        }
        const sorted = Array.from(ids).sort((a, b) => a.localeCompare(b));
        const m = new Map<string, string>();
        for (let i = 0; i < sorted.length; i++) m.set(sorted[i], REGION_COLORS[i % REGION_COLORS.length]);
        return m;
    }, [inputClaims]);

    const getComponentColors = useCallback((claimId: string): { fill: string; stroke: string } | null => {
        if (componentGroups.length < 2) return null;

        const componentColors: Array<[number, number, number]> = [
            [59, 130, 246],
            [16, 185, 129],
            [245, 158, 11],
            [139, 92, 246],
        ];

        const componentIdx = componentGroups.findIndex((c: string[]) => c.includes(claimId));
        if (componentIdx < 0) return null;
        const [r, g, b] = componentColors[componentIdx % componentColors.length];
        return {
            fill: `rgba(${r}, ${g}, ${b}, 0.14)`,
            stroke: `rgba(${r}, ${g}, ${b}, 0.35)`,
        };
    }, [componentGroups]);

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
        let layoutMode: 'chain' | 'keystone' | 'convergent' | 'forked' | 'constrained' | 'parallel' | 'force' = 'force';

        const chainPattern = problemStructure?.patterns?.find(p => p.type === 'chain') ?? null;
        const chainData = chainPattern?.type === 'chain' ? (chainPattern.data as ChainPatternData) : null;
        const keystonePattern = problemStructure?.patterns?.find(p => p.type === 'keystone') ?? null;
        const keystoneData = keystonePattern?.type === 'keystone' ? (keystonePattern.data as KeystonePatternData) : null;

        // Determine Layout Mode
        if (chainData && Array.isArray(chainData.chain) && chainData.chain.length >= 3) {
            layoutMode = 'chain';
        } else if (keystoneData?.keystone?.id) {
            layoutMode = 'keystone';
        } else if (primaryShape === 'convergent') {
            layoutMode = 'convergent';
        } else if (primaryShape === 'forked') {
            layoutMode = 'forked';
        } else if (primaryShape === 'constrained') {
            layoutMode = 'constrained';
        } else if (primaryShape === 'parallel') {
            layoutMode = 'parallel';
        } else if (primaryShape === 'sparse') {
            layoutMode = 'force';
        }

        if (layoutMode === 'chain' && chainData) {
            const longestChain = chainData.chain;
            const chainPositions = new Map<string, number>();
            longestChain.forEach((id: string, idx: number) => chainPositions.set(id, idx));
            const maxPos = longestChain.length - 1;

            longestChain.forEach((id: string, idx: number) => {
                const y = padding + (maxPos === 0 ? usableH / 2 : (idx / maxPos) * usableH);
                targets.set(id, { x: width / 2, y });
            });

            nodeIds.filter(id => !chainPositions.has(id)).forEach((id, idx) => {
                targets.set(id, {
                    x: padding + 50,
                    y: padding + (idx / Math.max(1, nodeIds.length - longestChain.length)) * usableH
                });
            });
        } else if (layoutMode === 'keystone' && keystoneData?.keystone?.id) {
            const keystoneId = keystoneData.keystone.id;
            targets.set(keystoneId, { x: width / 2, y: height / 2 });

            const neighbors = inputEdges
                .filter(e => e.from === keystoneId || e.to === keystoneId)
                .map(e => e.from === keystoneId ? e.to : e.from)
                .filter(id => id !== keystoneId);
            const uniq = Array.from(new Set(neighbors));
            const radius = Math.min(usableW, usableH) * 0.28;

            uniq.forEach((id, idx) => {
                const a = (idx / Math.max(uniq.length, 1)) * Math.PI * 2;
                targets.set(id, {
                    x: width / 2 + Math.cos(a) * radius,
                    y: height / 2 + Math.sin(a) * radius,
                });
            });
        } else if (layoutMode === 'convergent') {
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
            const peaks = problemStructure?.peaks?.map(p => p.id) ?? nodeIds;
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
            const peaks = problemStructure?.peaks?.map(p => p.id) ?? nodeIds;
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
                provenanceBulk: (typeof (c as any)?.provenanceBulk === 'number' && Number.isFinite((c as any)?.provenanceBulk)) ? (c as any).provenanceBulk : null,
                sourceRegionIds: Array.isArray((c as any)?.sourceRegionIds) ? (c as any).sourceRegionIds.map((x: any) => String(x)).filter((x: string) => x.trim().length > 0) : [],
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

        const isLinear = layoutMode === 'chain';
        const isKeystone = layoutMode === 'keystone';

        const simulation = d3.forceSimulation<GraphNode>(simNodes)
            .force('charge', d3.forceManyBody().strength(isLinear ? -700 : -1000))
            .force('link', d3.forceLink<GraphNode, GraphEdge>(simEdges)
                .id(d => d.id)
                .distance(link => {
                    const baseDist = link.type === 'supports' ? 120 :
                        link.type === 'conflicts' ? 220 :
                            link.type === 'tradeoff' ? 180 :
                                link.type === 'prerequisite' ? 150 :
                                120;
                    return isWideLayout ? baseDist * 1.6 : baseDist; // Increased distance
                })
                .strength(link => {
                    if (link.type === 'supports') return 0.45;
                    if (link.type === 'conflicts') return 0.15;
                    if (link.type === 'tradeoff') return 0.22;
                    if (link.type === 'prerequisite') return 0.3;
                    return 0.28;
                }))
            .force('center', d3.forceCenter(width / 2, height / 2).strength(0.01)) // Extremely weak centering
            .force('collision', d3.forceCollide<GraphNode>().radius(d => getNodeRadius(d) + 45)) // Large collision radius for labels
            // No x-centering force - let nodes spread horizontally
            .force('y', d3.forceY(height / 2).strength(0.02)) // Very weak vertical centering
            // Soft boundary force to keep nodes inside canvas
            .force('boundary', () => {
                simNodes.forEach(node => {
                    const r = getNodeRadius(node);
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
            .force('prerequisite', () => {
                simEdges.forEach(link => {
                    if (link.type === 'prerequisite') {
                        const source = typeof link.source === 'object' ? link.source : simNodes.find(n => n.id === link.source);
                        const target = typeof link.target === 'object' ? link.target : simNodes.find(n => n.id === link.target);

                        if (source && target && source.x !== undefined && target.x !== undefined) {
                            const dx = (target.x - source.x) - 60;
                            if (dx < 0) {
                                source.vx = (source.vx || 0) + dx * 0.01;
                                target.vx = (target.vx || 0) - dx * 0.01;
                            }
                        }
                    }
                });
            })
            .alphaDecay(0.02);

        if (isLinear || isKeystone) {
            simulation.force('xTarget', d3.forceX<GraphNode>(d => (targets.get(d.id)?.x ?? width / 2)).strength(isLinear ? 0.18 : 0.12));
            simulation.force('yTarget', d3.forceY<GraphNode>(d => (targets.get(d.id)?.y ?? height / 2)).strength(isLinear ? 0.22 : 0.12));
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
    const DRAG_THRESHOLD = 5;
    const dragState = useRef<{ nodeId: string | null; startX: number; startY: number; dragging: boolean; node: GraphNode | null }>({
        nodeId: null, startX: 0, startY: 0, dragging: false, node: null,
    });

    const handleMouseDown = (nodeId: string, node: GraphNode, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const svg = svgRef.current;
        if (!svg) return;

        const rect = svg.getBoundingClientRect();
        dragState.current = {
            nodeId,
            startX: e.clientX - rect.left,
            startY: e.clientY - rect.top,
            dragging: false,
            node,
        };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!svgRef.current) return;

        // Handle node dragging
        if (dragState.current.nodeId) {
            const rect = svgRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const dx = x - dragState.current.startX;
            const dy = y - dragState.current.startY;
            if (!dragState.current.dragging) {
                if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
                dragState.current.dragging = true;
                handleDragStart(dragState.current.nodeId);
            }
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
            if (dragState.current.dragging) {
                handleDragEnd(dragState.current.nodeId);
            } else {
                // Click (no drag threshold exceeded) — fire onNodeClick
                if (dragState.current.node) onNodeClick?.(dragState.current.node);
            }
            dragState.current = { nodeId: null, startX: 0, startY: 0, dragging: false, node: null };
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

                <filter id="edgeGlowBlue" x="-150%" y="-150%" width="400%" height="400%">
                    <feGaussianBlur stdDeviation="5" result="blur" />
                    <feFlood floodColor="#3b82f6" floodOpacity="0.45" />
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
                <marker id="arrowBlack" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#111827" />
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
                {componentGroups.length > 1 && componentGroups.map((component: string[], idx: number) => {
                    const componentNodes = nodes.filter(n => component.includes(n.id));
                    if (componentNodes.length === 0) return null;

                    const xs = componentNodes.map(n => n.x || 0);
                    const ys = componentNodes.map(n => n.y || 0);
                    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
                    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
                    const radius = Math.max(
                        Math.max(...xs) - Math.min(...xs),
                        Math.max(...ys) - Math.min(...ys)
                    ) / 2 + 60;

                    const colors = getComponentColors(component[0]);
                    if (!colors) return null;

                    return (
                        <circle
                            key={`component-${idx}`}
                            cx={centerX}
                            cy={centerY}
                            r={radius}
                            fill={colors.fill}
                            stroke={colors.stroke}
                            strokeWidth={1}
                            strokeDasharray="4,4"
                        />
                    );
                })}
                {/* Edges with enhanced visuals */}
                <g className="edges">
                    {edges.map((edge, i) => {
                        const coords = getEdgeCoords(edge);
                        if (!coords) return null;

                        const baseColor =
                            edge.type === 'supports' ? '#9ca3af' :
                                edge.type === 'conflicts' ? '#ef4444' :
                                    edge.type === 'tradeoff' ? '#f97316' :
                                        edge.type === 'prerequisite' ? '#111827' :
                                        '#9ca3af';
                        const dash =
                            edge.type === 'conflicts' ? '6,4' :
                                edge.type === 'tradeoff' ? '2,2' :
                                    undefined;
                        const markerEnd =
                            edge.type === 'supports' ? 'url(#arrowGray)' :
                                edge.type === 'conflicts' ? 'url(#arrowRed)' :
                                    edge.type === 'tradeoff' ? 'url(#arrowOrange)' :
                                        edge.type === 'prerequisite' ? 'url(#arrowBlack)' :
                                        undefined;
                        const midX = (coords.x1 + coords.x2) / 2;
                        const midY = (coords.y1 + coords.y2) / 2;

                        // Curved edge: quadratic bezier with perpendicular control point
                        const dx = coords.x2 - coords.x1;
                        const dy = coords.y2 - coords.y1;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        const curvature = Math.min(40, len * 0.2);
                        const cpX = midX - (dy / len) * curvature;
                        const cpY = midY + (dx / len) * curvature;
                        const curvePath = `M ${coords.x1} ${coords.y1} Q ${cpX} ${cpY} ${coords.x2} ${coords.y2}`;

                        return (
                            <g key={`edge-${i}`}>
                                {/* Wide glow layer */}
                                <path
                                    d={curvePath}
                                    fill="none"
                                    stroke={baseColor}
                                    strokeWidth={12}
                                    strokeOpacity={0.12}
                                />
                                {/* Main curved path */}
                                <path
                                    d={curvePath}
                                    fill="none"
                                    stroke={baseColor}
                                    strokeWidth={2.5}
                                    strokeDasharray={dash}
                                    markerEnd={markerEnd}
                                    filter={
                                        edge.type === 'conflicts' ? 'url(#edgeGlowRed)' :
                                            edge.type === 'tradeoff' ? 'url(#edgeGlowOrange)' :
                                                edge.type === 'prerequisite' ? 'url(#edgeGlowBlue)' :
                                                undefined
                                    }
                                />
                                {/* Invisible wider hit area for hover */}
                                <path
                                    d={curvePath}
                                    fill="none"
                                    stroke="transparent"
                                    strokeWidth={20}
                                    style={{ cursor: 'pointer' }}
                                    onMouseEnter={() => setHoveredEdge({ edge, x: cpX, y: cpY })}
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
                        const radius = getNodeRadius(node);
                        const isHovered = hoveredNode === node.id;
                        const isSelected = Array.isArray(selectedClaimIds) && selectedClaimIds.includes(node.id);
                        const dominantRegionId = (() => {
                            const ids = Array.isArray(node.sourceRegionIds) ? node.sourceRegionIds : [];
                            if (ids.length === 0) return null;
                            const counts = new Map<string, number>();
                            for (const rid of ids) {
                                const id = String(rid ?? '').trim();
                                if (!id) continue;
                                counts.set(id, (counts.get(id) ?? 0) + 1);
                            }
                            let best: string | null = null;
                            let bestCount = -1;
                            for (const [id, c] of counts) {
                                if (c > bestCount) {
                                    bestCount = c;
                                    best = id;
                                }
                            }
                            return best;
                        })();
                        const regionColor = dominantRegionId ? regionColorById.get(dominantRegionId) : null;
                        const fill = regionColor ? `${regionColor}cc` : "rgba(148,163,184,0.75)";
                        const stroke = regionColor ?? "rgba(148,163,184,0.55)";

                        return (
                            <g
                                key={node.id}
                                transform={`translate(${x}, ${y})`}
                                style={{ cursor: 'pointer' }}
                                onMouseDown={(e) => handleMouseDown(node.id, node, e)}
                                onMouseEnter={() => setHoveredNode(node.id)}
                                onMouseLeave={() => setHoveredNode(null)}
                            >
                                <circle r={radius} fill={fill} stroke={stroke} strokeWidth={2} opacity={0.9} />
                                {isSelected && (
                                    <circle r={radius + 7} fill="none" stroke="rgba(255,255,255,0.95)" strokeWidth={3.5} />
                                )}
                                {isHovered && !isSelected && (
                                    <circle r={radius + 5} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={2} />
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
                        const radius = getNodeRadius(node);
                        const isHovered = hoveredNode === node.id;
                        const isSelected = Array.isArray(selectedClaimIds) && selectedClaimIds.includes(node.id);

                        return (
                            <g
                                key={`label-${node.id}`}
                                transform={`translate(${x}, ${y})`}
                            >
                                <foreignObject
                                    x={-80}
                                    y={radius + 5}
                                    width={160}
                                    height={isHovered || isSelected ? 54 : 30}
                                    style={{ overflow: 'visible' }}
                                >
                                    <div
                                        style={{
                                            padding: isHovered || isSelected ? '4px 6px' : '2px 4px',
                                            fontSize: isHovered || isSelected ? 11 : 9,
                                            fontWeight: isHovered || isSelected ? 600 : 500,
                                            color: isHovered || isSelected ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.70)',
                                            textAlign: 'center',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            display: '-webkit-box',
                                            WebkitLineClamp: isHovered || isSelected ? 3 : 2,
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

            {/* Edge legend — bottom-left, fixed in SVG space */}
            <g transform={`translate(10, ${height - 68})`} style={{ pointerEvents: 'none' }}>
                <rect x={0} y={0} width={130} height={62} rx={5} fill="rgba(0,0,0,0.55)" />
                {[
                    { label: 'Supports', color: '#9ca3af', dash: undefined },
                    { label: 'Conflicts', color: '#ef4444', dash: '6,4' },
                    { label: 'Tradeoff', color: '#f97316', dash: '2,2' },
                    { label: 'Prerequisite', color: '#60a5fa', dash: undefined },
                ].map(({ label, color, dash }, idx) => (
                    <g key={label} transform={`translate(8, ${12 + idx * 13})`}>
                        <line x1={0} y1={0} x2={18} y2={0} stroke={color} strokeWidth={2} strokeDasharray={dash} />
                        <text x={24} y={4} fill="rgba(255,255,255,0.75)" fontSize={9} fontFamily="sans-serif">{label}</text>
                    </g>
                ))}
            </g>

        </svg>
    );
};

export default DecisionMapGraph;
