import { vi, beforeEach, describe, expect, it } from 'vitest';
import { getClient } from '../db/poolManager.js';
import userRepository from '../models/userRepository.js';

vi.mock('../db/poolManager', () => ({
  getClient: vi.fn(),
  getSystemClient: vi.fn(),
}));
vi.mock('../config/logging', () => ({ log: vi.fn() }));

/**
 * Better Auth resolves the password row with
 * `providerId === 'credential' && accountId === user.id`, so a credential
 * account whose `account_id` holds anything other than the user id is invisible
 * to sign-in and fails with "User not found" despite a valid hash.
 *
 * Both writes below used to store the email instead, which broke password
 * sign-in on Better Auth 1.7 -- for every user at creation, and again for any
 * user who changed their address.
 */

const USER_ID = '11111111-2222-3333-4444-555555555555';

function mockClient(): any {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  };
}

function accountWrites(client: any) {
  return client.query.mock.calls.filter(
    (call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('"account"')
  );
}

describe('credential account_id stays the user id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updateUserEmail does not write the new email into account_id', async () => {
    const client = mockClient();
    vi.mocked(getClient).mockResolvedValue(client);

    await userRepository.updateUserEmail(USER_ID, 'new-address@example.com');

    const writes = accountWrites(client);
    expect(writes).toHaveLength(1);

    const [sql, params] = writes[0];
    expect(sql).toContain("provider_id = 'credential'");
    // The address must not reach the account row at all; it belongs on "user".
    expect(params).not.toContain('new-address@example.com');
    expect(params[0]).toBe(USER_ID);
  });

  it('updateUserEmail still moves the address onto the user row', async () => {
    const client = mockClient();
    vi.mocked(getClient).mockResolvedValue(client);

    await userRepository.updateUserEmail(USER_ID, 'new-address@example.com');

    const userWrite = client.query.mock.calls.find(
      (call: any[]) =>
        typeof call[0] === 'string' && call[0].includes('UPDATE "user"')
    );
    expect(userWrite).toBeDefined();
    expect(userWrite[1]).toEqual(['new-address@example.com', USER_ID]);
    // A changed address is unproven until re-verified.
    expect(userWrite[0]).toContain('email_verified = false');
  });
});
