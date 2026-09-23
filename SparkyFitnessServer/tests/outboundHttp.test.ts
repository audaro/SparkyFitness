import net from 'net';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureOutboundHttp } from '../utils/outboundHttp.js';
import { describeError } from '../utils/errors.js';

let previousTimeout: unknown;
let previousAttemptTimeout: number;

beforeEach(() => {
  previousTimeout = axios.defaults.timeout;
  // The spy on setDefaultAutoSelectFamilyAttemptTimeout calls through, so
  // configureOutboundHttp() really does move the process-wide default.
  previousAttemptTimeout = net.getDefaultAutoSelectFamilyAttemptTimeout();
});

afterEach(() => {
  axios.defaults.timeout = previousTimeout as number;
  net.setDefaultAutoSelectFamilyAttemptTimeout(previousAttemptTimeout);
  vi.restoreAllMocks();
});

describe('describeError', () => {
  // The exact failure shape behind issue #2285: Node's Happy Eyeballs
  // connector rejects with an AggregateError carrying an empty message.
  it('unwraps an AggregateError that has no message of its own', () => {
    const ipv6 = Object.assign(new Error('connect ETIMEDOUT 2a02::1:443'), {
      code: 'ETIMEDOUT',
    });
    const ipv4 = Object.assign(new Error('connect ETIMEDOUT 1.2.3.4:443'), {
      code: 'ETIMEDOUT',
    });
    const aggregate = new AggregateError([ipv6, ipv4], '');

    const described = describeError(aggregate);
    expect(described).toContain('2a02::1:443');
    expect(described).toContain('1.2.3.4:443');
  });

  it('follows the cause chain when axios wraps a bare connect failure', () => {
    const cause = new AggregateError(
      [Object.assign(new Error(''), { code: 'ECONNREFUSED' })],
      ''
    );
    const wrapper = Object.assign(new Error(''), { cause });
    expect(describeError(wrapper)).toContain('ECONNREFUSED');
  });

  it('never returns an empty string', () => {
    expect(describeError(new Error(''))).toBe('Error');
    expect(describeError(undefined)).toBe('unknown error');
    expect(describeError(null)).toBe('unknown error');
    expect(describeError('boom')).toBe('boom');
  });

  it('leaves a self-describing message alone', () => {
    expect(
      describeError(new Error('Request failed with status code 401'))
    ).toBe('Request failed with status code 401');
  });
});

describe('configureOutboundHttp', () => {
  it('widens the per-family connect attempt timeout and sets a request timeout', () => {
    const setAttemptTimeout = vi.spyOn(
      net,
      'setDefaultAutoSelectFamilyAttemptTimeout'
    );

    configureOutboundHttp();

    expect(setAttemptTimeout).toHaveBeenCalledWith(5000);
    expect(axios.defaults.timeout).toBe(30000);
  });
});
