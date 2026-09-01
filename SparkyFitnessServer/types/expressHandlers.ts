import type { Request } from 'express';

/**
 * The params type to annotate middleware with — anything registered against
 * more than one route, so the concrete path segments are not known here.
 *
 * Express 5's own `ParamsDictionary` is `{ [key: string]: string | string[] }`,
 * and annotating a middleware with it pins `RouteParameters<Route>` during
 * `router.get(path, ...)` overload resolution: every handler sharing that route
 * then reads a path segment as `string | string[]`, even though a segment is
 * always a single string. A plain `Record<string, string>` accepts any route's
 * params while contributing no inference candidate, so the route literal still
 * decides what the handlers see.
 */
export type RouteParams = Record<string, string>;

/** A request whose path params are not known at the annotation site. */
export type AnyRouteRequest = Request<RouteParams>;
