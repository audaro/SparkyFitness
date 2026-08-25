/**
 * Just enough SVG path geometry to check the generated body map.
 *
 * `src/constants/muscleArt.generated.ts` is written by a script that already
 * validates what it emits, but the file is committed and the app renders the
 * committed copy — so the suite checks the artifact rather than trusting the
 * generator that produced it. That means measuring the paths, which means
 * turning them into points.
 *
 * Absolute `M`/`L`/`C`/`Z` only, which is all the illustration and the
 * hand-authored regions use; anything else throws rather than being silently
 * approximated. A curve becomes a chord chain, so every measurement here is a
 * close approximation, never an exact area.
 */

export interface Point {
  x: number;
  y: number;
}

/** Turns a path into a polyline, subdividing each cubic into `steps` chords. */
export function flattenPath(d: string, steps = 12): Point[] {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const points: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let command: string | null = null;
  let index = 0;

  const number = (): number => {
    const value = Number(tokens[index]);
    index += 1;
    if (!Number.isFinite(value)) {
      throw new Error(`Malformed path near token ${index}: ${d.slice(0, 60)}…`);
    }
    return value;
  };

  while (index < tokens.length) {
    if (/[a-z]/i.test(tokens[index])) {
      command = tokens[index].toUpperCase();
      index += 1;
      if (command === 'Z') {
        points.push({ ...start });
        continue;
      }
    }
    if (command === 'M') {
      cursor = { x: number(), y: number() };
      start = { ...cursor };
      points.push({ ...cursor });
      // A second coordinate pair after M is an implicit lineto, per the spec.
      command = 'L';
    } else if (command === 'L') {
      cursor = { x: number(), y: number() };
      points.push({ ...cursor });
    } else if (command === 'C') {
      const p1 = { x: number(), y: number() };
      const p2 = { x: number(), y: number() };
      const p3 = { x: number(), y: number() };
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const u = 1 - t;
        points.push({
          x: u * u * u * cursor.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
          y: u * u * u * cursor.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
        });
      }
      cursor = p3;
    } else {
      throw new Error(`Unsupported path command "${command}": ${d.slice(0, 60)}…`);
    }
  }

  return points;
}

/** Shoelace area, unsigned. */
export function polygonArea(points: Point[]): number {
  let twice = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    twice += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return Math.abs(twice) / 2;
}

/** Even-odd ray casting. */
export function pointInPolygon(polygon: Point[], point: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y) {
      const crossing = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < crossing) inside = !inside;
    }
  }
  return inside;
}
