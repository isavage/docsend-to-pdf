import { useState } from 'react';
import { useAuth } from './auth';

type Mode = 'login' | 'signup';

export function AuthModal({
  open,
  initialMode = 'signup',
  onClose,
}: {
  open: boolean;
  initialMode?: Mode;
  onClose: () => void;
}) {
  const { signup, login, config } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    const msg =
      mode === 'signup' ? await signup(email, password, name) : await login(email, password);
    setBusy(false);
    if (msg) setErr(msg);
    else onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6 animate-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            ×
          </button>
        </div>

        {config.googleEnabled && (
          <>
            <a
              href="/api/auth/google"
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C40.9 33.9 44 29.4 44 24c0-1.3-.1-2.6-.4-3.5z"/>
              </svg>
              Continue with Google
            </a>
            <div className="my-4 flex items-center gap-3 text-xs text-gray-400">
              <div className="flex-1 h-px bg-gray-100" /> or <div className="flex-1 h-px bg-gray-100" />
            </div>
          </>
        )}

        <form onSubmit={submit} className="space-y-3">
          {mode === 'signup' && (
            <input
              type="text"
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-[#635bff]/50"
            />
          )}
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-[#635bff]/50"
          />
          <input
            type="password"
            required
            placeholder="Password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-[#635bff]/50"
          />

          {err && <p className="text-sm text-red-500">{err}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 bg-[#635bff] text-white text-sm font-medium rounded-xl hover:bg-[#5048e7] transition-colors disabled:opacity-60"
          >
            {busy ? 'Please wait…' : mode === 'signup' ? 'Sign up' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-gray-500">
          {mode === 'signup' ? (
            <>Already have an account?{' '}
              <button onClick={() => setMode('login')} className="text-[#635bff] font-medium">Sign in</button>
            </>
          ) : (
            <>New here?{' '}
              <button onClick={() => setMode('signup')} className="text-[#635bff] font-medium">Create an account</button>
            </>
          )}
        </p>
        <p className="mt-2 text-center text-[11px] text-gray-400">
          Members can convert up to {config.memberTierMaxSlides} slides per document.
        </p>
      </div>
    </div>
  );
}
