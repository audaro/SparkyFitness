import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import ConfirmationDialog from '@/components/ui/ConfirmationDialog';

// `t` returns the key, so a string that reaches the DOM as English prose is a
// string that never went through i18n — which is what this suite is guarding.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const renderDialog = (
  props: Partial<React.ComponentProps<typeof ConfirmationDialog>> = {}
) =>
  render(
    <ConfirmationDialog
      open
      onOpenChange={jest.fn()}
      onConfirm={jest.fn()}
      title="Delete entry"
      description="This cannot be undone."
      {...props}
    />
  );

describe('ConfirmationDialog', () => {
  it('translates the labels it supplies itself', () => {
    renderDialog({ warning: 'The entry is referenced elsewhere.' });

    expect(screen.getByText('common.cancel')).toBeInTheDocument();
    expect(screen.getByText('common.confirm')).toBeInTheDocument();
    expect(screen.getByText('common.warning')).toBeInTheDocument();
  });

  it('prefers the caller’s labels, which arrive already translated', () => {
    renderDialog({ confirmLabel: 'Discard', cancelLabel: 'Keep editing' });

    expect(screen.getByText('Discard')).toBeInTheDocument();
    expect(screen.getByText('Keep editing')).toBeInTheDocument();
    expect(screen.queryByText('common.confirm')).not.toBeInTheDocument();
    expect(screen.queryByText('common.cancel')).not.toBeInTheDocument();
  });

  it('points the dialog’s aria-describedby at the description', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      'This cannot be undone.'
    );
  });

  it('renders the description in a div, so block-level nodes stay legal', () => {
    renderDialog({
      description: (
        <ul>
          <li>Two entries reference it.</li>
        </ul>
      ),
    });

    const describedBy = screen
      .getByRole('dialog')
      .getAttribute('aria-describedby');
    // A `<p>` here — Radix's default element — cannot contain a list, and React
    // would render it outside the description entirely.
    expect(document.getElementById(describedBy!)?.tagName).toBe('DIV');
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('mounts without Radix complaining about a missing description', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      renderDialog();

      const said = [...warn.mock.calls, ...error.mock.calls]
        .flat()
        .filter((arg): arg is string => typeof arg === 'string')
        .join('\n');
      expect(said).not.toMatch(/aria-describedby/i);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
