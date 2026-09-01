import { vi, type Mock } from 'vitest';
import type { PoolClient } from 'pg';

/**
 * A typed stand-in for the pg client these repository tests exercise. Only the two
 * methods the repositories actually call are implemented, so a test cannot lean on
 * something the real client would not provide.
 *
 * The repositories are typed against pg's `PoolClient`, so the mock is widened to
 * it once here rather than cast at every call site. That widening is the only
 * fiction: reaching for a third method still fails loudly at runtime, which is
 * the point of keeping the mock this thin.
 */
interface MockDbClientMethods {
  query: Mock;
  release: Mock;
}

export type MockDbClient = MockDbClientMethods & PoolClient;

export const createMockDbClient = (rows: unknown[] = [{}]): MockDbClient =>
  ({
    query: vi.fn().mockResolvedValue({ rows }),
    release: vi.fn(),
  }) as unknown as MockDbClient;

/**
 * Widens a locally-shaped query mock to the `PoolClient` the code under test is
 * typed against. Suites that need a bespoke `query` implementation build their
 * own object rather than using the factory above; this keeps the one honest
 * gap - a two-method stand-in for a full client - stated in a single place
 * instead of repeated as a cast at every mock.
 */
export const asPoolClient = (client: {
  query: Mock;
  release: Mock;
}): PoolClient => client as unknown as PoolClient;
