import { fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithClient as render } from '../../test-utils';
import { ProviderDialog } from '@/pages/Admin/OidcProviderDialog';
import type { OidcProvider } from '@/types/admin';

jest.mock('react-i18next', () =>
  jest.requireActual('../../mocks/reactI18next')
);

const provider: OidcProvider = {
  id: 'provider-id',
  issuer_url: 'https://identity.example.test',
  client_id: 'sparky',
  redirect_uris: [],
  scope: 'openid profile email',
  token_endpoint_auth_method: 'client_secret_post',
  response_types: ['code'],
  is_active: true,
};

it.each(['untouched', 'cleared'])(
  'omits the %s secret when saving an existing provider',
  (action) => {
    const onSave = jest.fn();
    render(
      <ProviderDialog provider={provider} onSave={onSave} onClose={jest.fn()} />
    );
    if (action === 'cleared') {
      fireEvent.change(screen.getByLabelText('Client Secret'), {
        target: { value: 'temporary' },
      });
      fireEvent.change(screen.getByLabelText('Client Secret'), {
        target: { value: '' },
      });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('client_secret');
  }
);

it.each(['replacement-secret', '*****'])(
  'sends replacement secret %s literally',
  (secret) => {
    const onSave = jest.fn();
    render(
      <ProviderDialog provider={provider} onSave={onSave} onClose={jest.fn()} />
    );
    fireEvent.change(screen.getByLabelText('Client Secret'), {
      target: { value: secret },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ client_secret: secret }),
      null
    );
  }
);
