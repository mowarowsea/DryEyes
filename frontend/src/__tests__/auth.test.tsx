// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LoginScreen } from '../components/LoginScreen';
import { api, authToken, setUnauthorizedHandler } from '../api';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  localStorage.clear();
  setUnauthorizedHandler(null);
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('authToken', () => {
  it('should persist the token in the browser so the user is restored next time', () => {
    expect(authToken.get()).toBe('');
    authToken.set('abc123');
    expect(authToken.get()).toBe('abc123');
    expect(localStorage.getItem('dryeyes.token')).toBe('abc123');

    authToken.clear();
    expect(authToken.get()).toBe('');
  });
});

describe('api auth', () => {
  it('should store the token on login and send it as a Bearer header', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch' as any);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ token: 'tok-1', expiresAt: '2099-01-01T00:00:00.000Z', user: { id: 'u1', username: 'alice' } })
    );

    await api.login('alice', 'password');
    expect(authToken.get()).toBe('tok-1');

    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await api.getWatches();

    const [, init] = fetchMock.mock.calls[1];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok-1' });
  });

  it('should drop the token and notify the app when the session expired', async () => {
    authToken.set('stale-token');
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);

    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValueOnce(jsonResponse({}, 401));

    await expect(api.getWatches()).rejects.toThrow('ログイン');
    expect(authToken.get()).toBe('');
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('should clear the token on logout even if the server call fails', async () => {
    authToken.set('tok-1');
    vi.spyOn(globalThis, 'fetch' as any).mockRejectedValueOnce(new Error('network down'));

    await api.logout();
    expect(authToken.get()).toBe('');
  });
});

// タブと送信ボタンが同じ「ログイン」表記になるため、送信ボタンは type で特定する
function submitCredentials(username: string, password: string) {
  fireEvent.change(screen.getByPlaceholderText('例: mowa'), { target: { value: username } });
  fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: password } });
  fireEvent.click(document.querySelector('button[type="submit"]')!);
}

describe('LoginScreen', () => {
  it('should log in and hand the session back to the app', async () => {
    const session = {
      token: 'tok-2',
      expiresAt: '2099-01-01T00:00:00.000Z',
      user: { id: 'u1', username: 'alice', ntfyTopic: 'dryeyes-alice-aaaaaa', createdAt: '' },
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch' as any);
    fetchMock.mockResolvedValueOnce(jsonResponse({ hasUsers: true })); // /auth/status
    fetchMock.mockResolvedValueOnce(jsonResponse(session)); // /auth/login

    const onAuthenticated = vi.fn();
    render(<LoginScreen onAuthenticated={onAuthenticated} />);

    submitCredentials('alice', 'password');

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(session));
    expect(authToken.get()).toBe('tok-2');
  });

  it('should start on the register tab when no user exists yet', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValueOnce(jsonResponse({ hasUsers: false }));

    render(<LoginScreen onAuthenticated={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /登録してはじめる/ })).toBeInTheDocument()
    );
    expect(screen.getByText(/最初のユーザーを作成します/)).toBeInTheDocument();
  });

  it('should surface the server error message on a failed login', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch' as any);
    fetchMock.mockResolvedValueOnce(jsonResponse({ hasUsers: true }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'ユーザー名またはパスワードが違います' }, 401));

    render(<LoginScreen onAuthenticated={vi.fn()} />);

    submitCredentials('alice', 'nope');

    await waitFor(() =>
      expect(screen.getByText('ユーザー名またはパスワードが違います')).toBeInTheDocument()
    );
    expect(authToken.get()).toBe('');
  });
});
