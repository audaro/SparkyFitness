import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FoodLibraryCard from '@/pages/Diary/FoodLibraryCard';

let mockIsActingOnBehalf = false;
const mockNavigate = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({ isActingOnBehalf: mockIsActingOnBehalf }),
}));

describe('FoodLibraryCard', () => {
  beforeEach(() => {
    mockIsActingOnBehalf = false;
    mockNavigate.mockClear();
  });

  it('offers the food library as the way off the Food page', () => {
    render(<FoodLibraryCard />);

    expect(screen.getByText('Food library')).toBeInTheDocument();
    expect(
      screen.getByText('Foods, meals and meal plans you can log from')
    ).toBeInTheDocument();
  });

  it('navigates to the foods page', () => {
    render(<FoodLibraryCard />);

    fireEvent.click(screen.getByRole('button'));

    expect(mockNavigate).toHaveBeenCalledWith('/foods');
  });

  // The library was never in the delegate nav, and `/foods` is not one of the
  // routes a delegate is redirected to, so offering it would be a dead end.
  it('renders nothing while acting on behalf of another user', () => {
    mockIsActingOnBehalf = true;

    const { container } = render(<FoodLibraryCard />);

    expect(container).toBeEmptyDOMElement();
  });
});
