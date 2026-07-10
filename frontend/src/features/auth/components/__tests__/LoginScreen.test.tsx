import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginScreen } from '../LoginScreen';

const { googleModuleLoads } = vi.hoisted(() => ({ googleModuleLoads: vi.fn() }));

vi.mock('@/features/auth/components/CILogonLogin', () => ({
  default: () => <button type="button">CILogon sign in</button>,
}));

vi.mock('@/features/auth/components/GoogleLogin', () => {
  googleModuleLoads();
  return { default: () => <button type="button">Google sign in</button> };
});

describe('LoginScreen provider ownership', () => {
  beforeEach(() => {
    googleModuleLoads.mockClear();
  });

  it('does not request the Google widget for CILogon authentication', () => {
    render(
      <LoginScreen authMethods={[{ name: 'cilogon', display_name: 'CILogon', enabled: true }]} />,
    );

    expect(screen.getByRole('button', { name: 'CILogon sign in' })).toBeInTheDocument();
    expect(googleModuleLoads).not.toHaveBeenCalled();
  });

  it('loads the Google widget only when Google is the selected provider', async () => {
    render(
      <LoginScreen authMethods={[{ name: 'google', display_name: 'Google', enabled: true }]} />,
    );

    expect(await screen.findByRole('button', { name: 'Google sign in' })).toBeInTheDocument();
    expect(googleModuleLoads).toHaveBeenCalledTimes(1);
  });
});
