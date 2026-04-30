import { useState, useCallback, useRef, useEffect } from 'react';

export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export function useZoomPan(svgRef: React.RefObject<SVGSVGElement>) {
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [isPanningState, setIsPanningState] = useState(false);
  const isPanning = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  const onWheel = useCallback((e: React.WheelEvent) => {
    // Zoom toward cursor position
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    setTransform(prev => {
      const scaleDelta = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.max(0.3, Math.min(8, prev.scale * scaleDelta));
      
      return {
        scale: newScale,
        x: mx - (mx - prev.x) * (newScale / prev.scale),
        y: my - (my - prev.y) * (newScale / prev.scale),
      };
    });
  }, [svgRef]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click for pan
    // If clicking on an interactive element, might want to prevent pan, 
    // but usually SVG background handles this.
    isPanning.current = true;
    setIsPanningState(true);
    startPos.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  }, [transform.x, transform.y]);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isPanning.current) return;
    setTransform(prev => ({
      ...prev,
      x: e.clientX - startPos.current.x,
      y: e.clientY - startPos.current.y,
    }));
  }, []);

  const onMouseUp = useCallback(() => {
    isPanning.current = false;
    setIsPanningState(false);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => onMouseMove(e);
    const handleMouseUp = () => onMouseUp();

    if (isPanningState) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPanningState, onMouseMove, onMouseUp]);

  const fitToScreen = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
  }, []);

  return {
    transform,
    onWheel,
    onMouseDown,
    fitToScreen,
    isPanning: isPanningState,
  };
}
