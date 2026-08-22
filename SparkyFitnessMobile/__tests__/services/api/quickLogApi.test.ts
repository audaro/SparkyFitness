import { postQuickLog } from '../../../src/services/api/quickLogApi';
import { apiFetch } from '../../../src/services/api/apiClient';

jest.mock('../../../src/services/api/apiClient', () => ({
  apiFetch: jest.fn(),
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe('postQuickLog', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('POSTs the message to /api/chat/quick-log', async () => {
    const payload = { text: '✅ Logged 2 eggs.', actions: [] };
    mockApiFetch.mockResolvedValueOnce(payload);

    await expect(postQuickLog('log 2 eggs')).resolves.toEqual(payload);

    expect(mockApiFetch).toHaveBeenCalledWith({
      endpoint: '/api/chat/quick-log',
      serviceName: 'Chat API',
      operation: 'quick log',
      method: 'POST',
      body: { message: 'log 2 eggs' },
    });
  });

  it('includes service_config_id only when provided', async () => {
    mockApiFetch.mockResolvedValueOnce({ text: 'ok', actions: [] });

    await postQuickLog('log water', 'cfg-123');

    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { message: 'log water', service_config_id: 'cfg-123' },
      })
    );
  });

  it('propagates apiFetch errors', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(postQuickLog('hi')).rejects.toThrow('Network request failed');
  });
});
