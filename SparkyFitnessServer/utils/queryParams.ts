/**
 * One query-string value as a string.
 *
 * Express types `req.query.x` as `string | ParsedQs | (string | ParsedQs)[]`,
 * because a client can repeat a key (`?a=1&a=2`) or nest it (`?a[b]=1`). Every
 * route reading a single scalar wants the string case; a repeated or nested key
 * is a malformed request, and returning `undefined` sends it down the same
 * "missing parameter" path as an omitted one rather than handing an array to a
 * function that expects an id or a date.
 */
export function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
