export const LAYOUT = {
  W: 1000,
  H: 700,
  MARGIN: 28,
  
  // Nodes
  NODE_R_MIN: 3.5,
  NODE_R_MAX: 9.0,
  NODE_BASE_R: 4.0,
  NODE_DEGREE_SCALE: 0.7,
  
  // Footprints
  FOOTPRINT_BASE_R: 18,
  FOOTPRINT_WEIGHT_SCALE: 28,
  FOOTPRINT_MIN_R: 8,
  
  // Donut Glyphs
  DONUT_R_MIN: 11,
  DONUT_R_MAX: 22,
  DONUT_DENSITY_SCALE: 0.5,
  DONUT_WIDTH_RATIO: 0.35,
  DONUT_WIDTH_MIN: 3.5,
  
  // Geometry / Hulls
  HULL_PAD_1PT: 5,
  HULL_PAD_2PT: 4,
  BASIN_RECT_PAD: 16,
  BOUNDS_PAD: 0.05,
} as const;
