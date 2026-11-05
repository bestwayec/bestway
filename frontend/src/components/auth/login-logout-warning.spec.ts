import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => state.params }));
vi.mock('next-intl', () => ({ useLocale: () => 'uz', useTranslations: () => (key: string) => key }));
vi.mock('@/i18n/navigation', () => ({ Link: ({ children }: { children: React.ReactNode }) => React.createElement('a', null, children) }));
vi.mock('./google-auth-button', () => ({ GoogleAuthButton: () => null }));
import { LoginForm } from './login-form';

describe('unconfirmed logout warning', () => {
  it('renders an accessible warning on a failed server revocation', () => {
    state.params = new URLSearchParams('logout_unconfirmed=1');
    const html = renderToStaticMarkup(React.createElement(LoginForm));
    expect(html).toContain('logoutUnconfirmed');
    expect(html).toContain('role="alert"');
  });
  it('does not show the warning after confirmed logout', () => {
    state.params = new URLSearchParams();
    expect(renderToStaticMarkup(React.createElement(LoginForm))).not.toContain('logoutUnconfirmed');
  });
});
