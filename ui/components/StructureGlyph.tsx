import React from 'react';
import { PrimaryShape } from '../../shared/contract';

interface StructureGlyphProps {
  pattern: PrimaryShape; // primary layer shape
  residualPattern?: PrimaryShape; // second layer shape (if any)
  claimCount: number;
  width?: number;
  height?: number;
  onClick?: () => void;
}

/**
 * StructureGlyph — Visual encoding of structural analysis
 *
 * Main canvas shows the primary shape.
 * If residualPattern is provided, a mini version appears in a box at bottom-right.
 * Secondary patterns are NOT rendered here; they belong in a separate badge list.
 */
const StructureGlyph: React.FC<StructureGlyphProps> = ({
  pattern,
  residualPattern,
  claimCount,
  width = 120,
  height = 80,
  onClick,
}) => {
  const cx = width / 2;
  const cy = height / 2;
  const markerIdPrefix = React.useId().replace(/:/g, '');
  const arrowBlueId = `${markerIdPrefix}arrowBlue`;
  const arrowRedId = `${markerIdPrefix}arrowRed`;
  const arrowOrangeId = `${markerIdPrefix}arrowOrange`;
  const arrowGreenId = `${markerIdPrefix}arrowGreen`;

  const visibleNodes = Math.min(claimCount, pattern === 'sparse' ? 6 : 8);

  // Helper position generators (same as before)
  const getConvergentPositions = () => {
    const satelliteCount = Math.min(visibleNodes - 1, 6);
    const radius = Math.min(width, height) * 0.3;
    const positions: Array<{ x: number; y: number; isHub: boolean }> = [
      { x: cx, y: cy, isHub: true },
    ];
    for (let i = 0; i < satelliteCount; i++) {
      const angle = (i / satelliteCount) * Math.PI * 2 - Math.PI / 2;
      positions.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        isHub: false,
      });
    }
    return positions;
  };

  const getForkedPositions = () => {
    const leftCount = Math.ceil(visibleNodes / 2);
    const rightCount = visibleNodes - leftCount;
    const leftBaseX = width * 0.25;
    const rightBaseX = width * 0.75;
    const clusterRadius = Math.min(width, height) * 0.15;
    const positions: Array<{ x: number; y: number; side: 'left' | 'right' }> = [];

    for (let i = 0; i < leftCount; i++) {
      const angle = (i / leftCount) * Math.PI * 2;
      positions.push({
        x: leftBaseX + Math.cos(angle) * clusterRadius,
        y: cy + Math.sin(angle) * clusterRadius * 0.6,
        side: 'left',
      });
    }
    for (let i = 0; i < rightCount; i++) {
      const angle = (i / rightCount) * Math.PI * 2 + Math.PI;
      positions.push({
        x: rightBaseX + Math.cos(angle) * clusterRadius,
        y: cy + Math.sin(angle) * clusterRadius * 0.6,
        side: 'right',
      });
    }
    return positions;
  };

  const getConstrainedPositions = () => {
    const mainCount = Math.min(visibleNodes, 2);
    const satelliteCount = Math.max(0, visibleNodes - 2);
    const positions: Array<{ x: number; y: number; isMain: boolean; side?: 'left' | 'right' }> = [];

    positions.push({ x: width * 0.2, y: cy, isMain: true, side: 'left' });
    if (mainCount > 1) {
      positions.push({ x: width * 0.8, y: cy, isMain: true, side: 'right' });
    }

    for (let i = 0; i < satelliteCount; i++) {
      const t = (i + 1) / (satelliteCount + 1);
      const x = width * (0.2 + 0.6 * t);
      const bulge = Math.sin(t * Math.PI) * height * 0.25;
      positions.push({ x, y: cy - bulge, isMain: false });
    }
    return positions;
  };

  const getParallelPositions = () => {
    const positions: Array<{ x: number; y: number; cluster: number }> = [];
    const clusters = Math.min(3, Math.max(2, Math.ceil(visibleNodes / 3)));
    const nodesPerCluster = Math.ceil(visibleNodes / clusters);

    const centers = [
      { x: width * 0.3, y: height * 0.35 },
      { x: width * 0.7, y: height * 0.65 },
      { x: width * 0.5, y: height * 0.2 },
    ].slice(0, clusters);

    centers.forEach((center, cIdx) => {
      const count = Math.min(nodesPerCluster, visibleNodes - positions.length);
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + cIdx;
        const spread = Math.min(width, height) * 0.08;
        positions.push({
          x: center.x + Math.cos(angle) * spread,
          y: center.y + Math.sin(angle) * spread,
          cluster: cIdx,
        });
      }
    });
    return positions;
  };

  const getSparsePositions = () => {
    const positions: Array<{ x: number; y: number }> = [];
    const count = Math.min(visibleNodes, 7);
    const seeds = [0.2, 0.5, 0.8, 0.3, 0.7, 0.4, 0.6];
    for (let i = 0; i < count; i++) {
      positions.push({
        x: width * (seeds[i % seeds.length] + ((i * 0.05) % 0.15) - 0.05),
        y: height * (seeds[(i + 3) % seeds.length] + ((i * 0.03) % 0.15) - 0.05),
      });
    }
    return positions;
  };

  const renderPrimaryShape = () => {
    switch (pattern) {
      case 'convergent': {
        const positions = getConvergentPositions();
        const hub = positions[0];
        const satellites = positions.slice(1);
        return (
          <g className="convergent-shape">
            {satellites.map((sat, i) => (
              <line
                key={`arrow-${i}`}
                x1={sat.x}
                y1={sat.y}
                x2={hub.x}
                y2={hub.y}
                stroke="rgba(16, 185, 129, 0.5)"
                strokeWidth={1.5}
                markerEnd={`url(#${arrowGreenId})`}
              />
            ))}
            {satellites.map((sat, i) => (
              <circle
                key={`sat-${i}`}
                cx={sat.x}
                cy={sat.y}
                r={4}
                fill="rgba(16, 185, 129, 0.7)"
                stroke="rgba(16, 185, 129, 0.3)"
                strokeWidth={1}
              />
            ))}
            <circle
              cx={hub.x}
              cy={hub.y}
              r={7}
              fill="rgba(16, 185, 129, 0.9)"
              stroke="#10b981"
              strokeWidth={1.5}
            />
            <circle
              cx={hub.x}
              cy={hub.y}
              r={Math.min(width, height) * 0.35}
              fill="none"
              stroke="rgba(16, 185, 129, 0.15)"
              strokeWidth={1}
              strokeDasharray="2,3"
            />
          </g>
        );
      }
      case 'forked': {
        const positions = getForkedPositions();
        const leftNodes = positions.filter((p) => p.side === 'left');
        const rightNodes = positions.filter((p) => p.side === 'right');
        const leftCenter = leftNodes[0] || { x: width * 0.25, y: cy };
        const rightCenter = rightNodes[0] || { x: width * 0.75, y: cy };
        return (
          <g className="forked-shape">
            {leftNodes.map((node, i) => (
              <circle
                key={`left-${i}`}
                cx={node.x}
                cy={node.y}
                r={i === 0 ? 6 : 3}
                fill={i === 0 ? 'rgba(239, 68, 68, 0.8)' : 'rgba(239, 68, 68, 0.5)'}
              />
            ))}
            {rightNodes.map((node, i) => (
              <circle
                key={`right-${i}`}
                cx={node.x}
                cy={node.y}
                r={i === 0 ? 6 : 3}
                fill={i === 0 ? 'rgba(239, 68, 68, 0.8)' : 'rgba(239, 68, 68, 0.5)'}
              />
            ))}
            <line
              x1={leftCenter.x + 6}
              y1={cy}
              x2={rightCenter.x - 6}
              y2={cy}
              stroke="#ef4444"
              strokeWidth={2.5}
              strokeDasharray="4,3"
              markerStart={`url(#${arrowRedId})`}
              markerEnd={`url(#${arrowRedId})`}
            />
          </g>
        );
      }
      case 'constrained': {
        const positions = getConstrainedPositions();
        const mainNodes = positions.filter((p) => p.isMain);
        const satellites = positions.filter((p) => !p.isMain);
        const leftNode = mainNodes.find((n) => n.side === 'left') || { x: width * 0.2, y: cy };
        const rightNode = mainNodes.find((n) => n.side === 'right') || { x: width * 0.8, y: cy };
        return (
          <g className="constrained-shape">
            <path
              d={`M ${leftNode.x} ${cy} Q ${cx} ${cy - height * 0.2} ${rightNode.x} ${cy}`}
              fill="none"
              stroke="rgba(249, 115, 22, 0.4)"
              strokeWidth={2}
              strokeDasharray="3,2"
            />
            {satellites.map((sat, i) => (
              <circle key={`sat-${i}`} cx={sat.x} cy={sat.y} r={3} fill="rgba(249, 115, 22, 0.6)" />
            ))}
            <circle
              cx={leftNode.x}
              cy={cy}
              r={6}
              fill="rgba(249, 115, 22, 0.8)"
              stroke="#f97316"
              strokeWidth={1}
            />
            <circle
              cx={rightNode.x}
              cy={cy}
              r={6}
              fill="rgba(249, 115, 22, 0.8)"
              stroke="#f97316"
              strokeWidth={1}
            />
            <line
              x1={leftNode.x + 6}
              y1={cy}
              x2={rightNode.x - 6}
              y2={cy}
              stroke="#f97316"
              strokeWidth={2}
              markerStart={`url(#${arrowOrangeId})`}
              markerEnd={`url(#${arrowOrangeId})`}
            />
          </g>
        );
      }
      case 'parallel': {
        const positions = getParallelPositions();
        const clusters = [...new Set(positions.map((p) => p.cluster))];
        return (
          <g className="parallel-shape">
            <line
              x1={width * 0.1}
              y1={cy}
              x2={width * 0.9}
              y2={cy}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
            <line
              x1={cx}
              y1={height * 0.1}
              x2={cx}
              y2={height * 0.9}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
            {clusters.map((c, i) => {
              const clusterNodes = positions.filter((p) => p.cluster === c);
              if (clusterNodes.length === 0) return null;
              const avgX = clusterNodes.reduce((s, n) => s + n.x, 0) / clusterNodes.length;
              const avgY = clusterNodes.reduce((s, n) => s + n.y, 0) / clusterNodes.length;
              const maxDist = Math.max(
                ...clusterNodes.map((n) => Math.hypot(n.x - avgX, n.y - avgY))
              );
              return (
                <circle
                  key={`cluster-${i}`}
                  cx={avgX}
                  cy={avgY}
                  r={maxDist + 5}
                  fill="none"
                  stroke="rgba(168, 85, 247, 0.15)"
                  strokeWidth={1}
                  strokeDasharray="2,2"
                />
              );
            })}
            {positions.map((node, i) => (
              <circle
                key={`node-${i}`}
                cx={node.x}
                cy={node.y}
                r={4}
                fill={`rgba(168, 85, 247, ${0.4 + node.cluster * 0.2})`}
                stroke="rgba(168, 85, 247, 0.3)"
                strokeWidth={1}
              />
            ))}
          </g>
        );
      }
      case 'sparse':
      default: {
        const positions = getSparsePositions();
        return (
          <g className="sparse-shape">
            {positions.map((pos, i) => (
              <circle key={i} cx={pos.x} cy={pos.y} r={3} fill="rgba(148, 163, 184, 0.5)" />
            ))}
            <text
              x={cx}
              y={height * 0.9}
              textAnchor="middle"
              fontSize={10}
              fill="rgba(148, 163, 184, 0.4)"
            >
              ?
            </text>
          </g>
        );
      }
    }
  };

  // Mini version of a shape for residual box (scaled to 20x20 area)
  const renderMiniShape = (shape: PrimaryShape) => {
    const boxSize = 32; // larger
    const boxX = width - boxSize - 4;
    const boxY = height - boxSize - 4;
    const miniW = boxSize;
    const miniH = boxSize;
    const miniCx = boxX + miniW / 2;
    const miniCy = boxY + miniH / 2;

    const baseShape = (() => {
      switch (shape) {
        case 'convergent':
          return (
            <>
              <circle cx={miniCx} cy={miniCy} r={6} fill="rgba(16, 185, 129, 0.9)" />
              <circle cx={miniCx - 6} cy={miniCy - 4} r={3} fill="rgba(16, 185, 129, 0.7)" />
              <circle cx={miniCx + 6} cy={miniCy + 4} r={3} fill="rgba(16, 185, 129, 0.7)" />
              <line
                x1={miniCx - 6}
                y1={miniCy - 4}
                x2={miniCx}
                y2={miniCy}
                stroke="rgba(16, 185, 129, 0.5)"
                strokeWidth={1.5}
                markerEnd={`url(#${arrowGreenId})`}
              />
              <line
                x1={miniCx + 6}
                y1={miniCy + 4}
                x2={miniCx}
                y2={miniCy}
                stroke="rgba(16, 185, 129, 0.5)"
                strokeWidth={1.5}
                markerEnd={`url(#${arrowGreenId})`}
              />
            </>
          );
        case 'forked':
          return (
            <>
              <circle cx={miniCx - 7} cy={miniCy} r={4} fill="rgba(239, 68, 68, 0.8)" />
              <circle cx={miniCx + 7} cy={miniCy} r={4} fill="rgba(239, 68, 68, 0.8)" />
              <line
                x1={miniCx - 3}
                y1={miniCy}
                x2={miniCx + 3}
                y2={miniCy}
                stroke="#ef4444"
                strokeWidth={2}
                strokeDasharray="2,1"
              />
            </>
          );
        case 'constrained':
          return (
            <>
              <circle cx={miniCx - 7} cy={miniCy} r={4} fill="rgba(249, 115, 22, 0.8)" />
              <circle cx={miniCx + 7} cy={miniCy} r={4} fill="rgba(249, 115, 22, 0.8)" />
              <path
                d={`M ${miniCx - 7} ${miniCy} Q ${miniCx} ${miniCy - 6} ${miniCx + 7} ${miniCy}`}
                fill="none"
                stroke="#f97316"
                strokeWidth={2}
                strokeDasharray="2,1"
              />
            </>
          );
        case 'parallel':
          return (
            <>
              <circle cx={miniCx - 5} cy={miniCy - 4} r={3} fill="rgba(168, 85, 247, 0.8)" />
              <circle cx={miniCx + 5} cy={miniCy + 4} r={3} fill="rgba(168, 85, 247, 0.8)" />
              <circle cx={miniCx - 4} cy={miniCy + 5} r={2} fill="rgba(168, 85, 247, 0.6)" />
            </>
          );
        case 'sparse':
          return (
            <>
              <circle cx={miniCx - 4} cy={miniCy - 3} r={2} fill="rgba(148, 163, 184, 0.6)" />
              <circle cx={miniCx + 5} cy={miniCy + 4} r={2} fill="rgba(148, 163, 184, 0.6)" />
              <text
                x={miniCx}
                y={miniCy + 10}
                textAnchor="middle"
                fontSize={7}
                fill="rgba(148, 163, 184, 0.5)"
              >
                ?
              </text>
            </>
          );
        default:
          return null;
      }
    })();

    return (
      <g transform={`translate(${boxX}, ${boxY})`}>
        <rect
          x={0}
          y={0}
          width={miniW}
          height={miniH}
          rx={4}
          fill="rgba(0,0,0,0.2)"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth={1}
        />
        {baseShape}
        {/* Label "L2" in corner */}
        <text x={2} y={8} fontSize={6} fill="rgba(255,255,255,0.4)">
          L2
        </text>
      </g>
    );
  };

  return (
    <div
      className="relative cursor-pointer group"
      onClick={onClick}
      title={`${pattern}${residualPattern ? ` with residual ${residualPattern}` : ''} — click to explore`}
    >
      <svg width={width} height={height} className="overflow-visible">
        <defs>
          <marker
            id={arrowBlueId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(59, 130, 246, 0.7)" />
          </marker>
          <marker
            id={arrowRedId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
          </marker>
          <marker
            id={arrowOrangeId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#f97316" />
          </marker>
          <marker
            id={arrowGreenId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(16, 185, 129, 0.8)" />
          </marker>
        </defs>

        {/* Primary shape */}
        {renderPrimaryShape()}

        {/* Residual shape (if present) */}
        {residualPattern && renderMiniShape(residualPattern)}
      </svg>

      <div className="absolute inset-0 bg-brand-500/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
        <span className="text-xs font-medium text-brand-400">Click to explore →</span>
      </div>
    </div>
  );
};

export default StructureGlyph;
