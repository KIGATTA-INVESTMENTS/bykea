import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import LoginPage from './pages/LoginPage';

beforeEach(() => {
  localStorage.clear();
});

test('shows InGo splash on first visit at /', () => {
  render(<App />);
  const logo = screen.getByAltText('InGo');
  expect(logo).toBeInTheDocument();
});

test('login page is on its own path', () => {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
});
