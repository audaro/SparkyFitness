import React, { useMemo } from 'react';
import { Canvas, Path, Skia, type SkPath } from '@shopify/react-native-skia';

export interface HexagonSegment {
  /** 0..1. Values outside the range are clamped. */
  percent: number;
  color: string;
}

interface HexagonProgressRingProps {
  size: number;
  strokeWidth: number;
  segments: HexagonSegment[];
  trackColor: string;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Vertices of a regular hexagon with a point at top and bottom, matching the
 * shape the screen is modelled on. Index 0 is the top vertex, running
 * clockwise.
 */
function hexagonVertices(center: number, radius: number): Point[] {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = ((-90 + 60 * i) * Math.PI) / 180;
    return {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
    };
  });
}

/**
 * The point at fraction `t` (0..1) along the hexagon's perimeter, walking
 * clockwise from the top vertex. A regular hexagon has six equal edges, so the
 * walk is a plain edge index plus a fraction along that edge — no arc-length
 * table needed.
 */
function pointAt(vertices: Point[], t: number): Point {
  const scaled = Math.max(0, Math.min(1, t)) * 6;
  const edge = Math.min(5, Math.floor(scaled));
  const within = scaled - edge;
  const from = vertices[edge]!;
  const to = vertices[(edge + 1) % 6]!;
  return {
    x: from.x + (to.x - from.x) * within,
    y: from.y + (to.y - from.y) * within,
  };
}

/**
 * The stroke covering perimeter fraction `start` to `end`, including any
 * corners it crosses.
 *
 * The corners are the reason this is not a straight line from A to B: a
 * segment spanning a vertex has to bend around it, or a group whose share of
 * the ring crosses a corner would render as a chord cutting across the shape.
 */
function segmentPath(vertices: Point[], start: number, end: number): SkPath {
  const builder = Skia.PathBuilder.Make();
  if (end <= start) return builder.build();

  const from = pointAt(vertices, start);
  builder.moveTo(from.x, from.y);
  // Vertices strictly inside the span, in order.
  for (let vertex = Math.ceil(start * 6); vertex < end * 6; vertex += 1) {
    const point = vertices[vertex % 6]!;
    builder.lineTo(point.x, point.y);
  }
  const to = pointAt(vertices, end);
  builder.lineTo(to.x, to.y);
  return builder.build();
}

/**
 * A hexagonal progress ring split into one arc per training group.
 *
 * Each group owns an equal share of the perimeter and fills its own share
 * independently, so the ring reads as several targets at once rather than as
 * one blended total — a group at zero stays visibly empty even when its
 * neighbours are complete.
 */
const HexagonProgressRing: React.FC<HexagonProgressRingProps> = ({
  size,
  strokeWidth,
  segments,
  trackColor,
}) => {
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;

  const { trackPath, filledPaths } = useMemo(() => {
    const vertices = hexagonVertices(center, radius);
    const track = segmentPath(vertices, 0, 1);
    const share = segments.length > 0 ? 1 / segments.length : 0;
    const filled = segments.map((segment, index) => {
      const start = index * share;
      const percent = Math.max(0, Math.min(1, segment.percent));
      return {
        color: segment.color,
        path: segmentPath(vertices, start, start + share * percent),
      };
    });
    return { trackPath: track, filledPaths: filled };
  }, [center, radius, segments]);

  return (
    <Canvas style={{ width: size, height: size }}>
      <Path
        path={trackPath}
        style="stroke"
        strokeWidth={strokeWidth}
        color={trackColor}
        strokeJoin="round"
        strokeCap="round"
      />
      {filledPaths.map((segment, index) => (
        <Path
          key={index}
          path={segment.path}
          style="stroke"
          strokeWidth={strokeWidth}
          color={segment.color}
          strokeJoin="round"
          strokeCap="round"
        />
      ))}
    </Canvas>
  );
};

export default HexagonProgressRing;
