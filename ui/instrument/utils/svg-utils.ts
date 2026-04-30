/** SVG arc path for a donut segment. Angles in radians, 0 = top (12 o'clock). */
export function donutArc(
  cx: number,
  cy: number,
  r: number,
  width: number,
  startAngle: number,
  endAngle: number
): string {
  if (endAngle - startAngle >= Math.PI * 2 - 0.001) {
    // Full circle — use two half-arcs to avoid SVG zero-length arc issue
    const outer = r,
      inner = r - width;
    return [
      `M ${cx} ${cy - outer}`,
      `A ${outer} ${outer} 0 1 1 ${cx} ${cy + outer}`,
      `A ${outer} ${outer} 0 1 1 ${cx} ${cy - outer}`,
      `Z`,
      `M ${cx} ${cy - inner}`,
      `A ${inner} ${inner} 0 1 0 ${cx} ${cy + inner}`,
      `A ${inner} ${inner} 0 1 0 ${cx} ${cy - inner}`,
      `Z`,
    ].join(' ');
  }
  const outer = r,
    inner = r - width;
  const cos = Math.cos,
    sin = Math.sin;
  // Convert from "0=top clockwise" to SVG's "0=right counterclockwise"
  const toSvg = (a: number) => a - Math.PI / 2;
  const a1 = toSvg(startAngle),
    a2 = toSvg(endAngle);
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  const ox1 = cx + outer * cos(a1),
    oy1 = cy + outer * sin(a1);
  const ox2 = cx + outer * cos(a2),
    oy2 = cy + outer * sin(a2);
  const ix2 = cx + inner * cos(a2),
    iy2 = cy + inner * sin(a2);
  const ix1 = cx + inner * cos(a1),
    iy1 = cy + inner * sin(a1);
  return [
    `M ${ox1} ${oy1}`,
    `A ${outer} ${outer} 0 ${large} 1 ${ox2} ${oy2}`,
    `L ${ix2} ${iy2}`,
    `A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1}`,
    `Z`,
  ].join(' ');
}
