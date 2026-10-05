import { useEffect, useState } from 'react';
import './index.css';
import { AuthModal } from './AuthModal';
import { useAuth } from './auth';

interface ConversionJob {
  id: string;
  url: string;
  password?: string;
  tier: 'free' | 'member';
  email?: string;
  status: string;
  progress: number;
  stage?: string;
  totalSlides?: number;
  capturedSlides: number;
  outputPath?: string;
  outputSizeBytes?: number;
  error?: string;
}

export default function App() {
  const auth = useAuth();
  const [url, setUrl] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [job, setJob] = useState<ConversionJob | null>(null);
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<{ score: number; strengths: string[]; weaknesses: string[] } | null>(null);
  const [authModal, setAuthModal] = useState<null | 'login' | 'signup'>(null);

  // After the Google OAuth redirect we land on `/?signedin=1` — refresh state
  // (the session cookie is already set) and clean up the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('signedin') === '1') {
      void auth.refresh();
      window.history.replaceState({}, '', '/');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url || !url.startsWith('http')) return setError('Please enter a valid DocSend URL');

    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, password: password || undefined, email: email || undefined }),
      });
      const data = await res.json();
      if (data.error) return setError(data.error);
      if (data.jobId) {
        pollJob(data.jobId);
      }
    } catch {
      setError('Failed to start conversion. Check your connection.');
    }
  }

  function pollJob(jobId: string) {
    const evtSource = new EventSource(`/api/events/${jobId}`);
    evtSource.onmessage = (event) => {
      const updatedJob = JSON.parse(event.data) as ConversionJob;
      setJob(updatedJob);

      if (updatedJob.status === 'completed') {
        evtSource.close();
        // Auto-trigger analysis for pitch deck upsell
        requestPitchDeckAnalysis(updatedJob.id);
      } else if (updatedJob.status === 'failed') {
        evtSource.close();
      }
    };
    evtSource.onerror = () => {
      evtSource.close();
      // Safety net: if the stream died mid-job, fetch the final state once.
      fetch(`/api/jobs/${jobId}`, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setJob(j))
        .catch(() => {});
    };
  }

  async function requestPitchDeckAnalysis(jobId: string) {
    setAnalyzing(true);
    try {
      const res = await fetch('/api/pitch-deck/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (data.analysis) {
        setAnalysis(data.analysis);
      }
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      {/* Header */}
      <header className="border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect x="2" y="2" width="24" height="24" rx="6" fill="#635bff"/>
              <path d="M8 9h12M8 14h12M8 19h8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="text-lg font-semibold text-gray-900">DocSend PDF</span>
          </div>
          <nav className="hidden md:flex gap-8 text-sm text-gray-600">
            <a href="#" className="hover:text-gray-900 transition-colors">Features</a>
            <a href="#pricing" className="hover:text-gray-900 transition-colors">Pricing</a>
            <a href="https://github.com/isavage/docsend-to-pdf" target="_blank" rel="noreferrer" className="hover:text-gray-900 transition-colors">GitHub</a>
          </nav>

          {auth.user ? (
            <div className="flex items-center gap-3">
              <span className="hidden sm:flex items-center gap-2 text-sm text-gray-600">
                <span className="w-7 h-7 rounded-full bg-[#635bff]/10 text-[#635bff] flex items-center justify-center text-xs font-semibold">
                  {(auth.user.name || auth.user.email || '?')[0].toUpperCase()}
                </span>
                {auth.user.name || auth.user.email}
              </span>
              {auth.user.emailVerified ? (
                <span className="text-[11px] font-medium px-2 py-1 rounded-full bg-green-50 text-green-700">Member · {auth.config.memberTierMaxSlides} slides</span>
              ) : (
                <VerifyBanner onResend={auth.resendVerification} />
              )}
              <button
                onClick={() => void auth.logout()}
                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
              >
                Sign out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAuthModal('login')}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                Sign in
              </button>
              <button
                onClick={() => setAuthModal('signup')}
                className="px-4 py-2 bg-[#635bff] text-white text-sm font-medium rounded-full hover:bg-[#5048e7] transition-colors"
              >
                Sign up free
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-16 text-center">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900 leading-tight">
          Turn any DocSend link into a<br/>beautiful PDF in seconds
        </h1>
        <p className="mt-4 text-lg text-gray-500 max-w-xl mx-auto">
          No plugins, no sign-up needed for basic use. Just paste your DocSend share link and download a pixel-perfect PDF.
        </p>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="mt-10 animate-in">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-2 flex flex-col sm:flex-row gap-2 max-w-2xl mx-auto">
            <input
              type="text"
              placeholder="https://docsend.com/view/your-link"
              value={url}
              onChange={e => setUrl(e.target.value)}
              className="flex-1 px-4 py-3 bg-transparent outline-none text-gray-900 placeholder-gray-400 text-sm"
            />
            <button
              type="submit"
              className="px-6 py-3 bg-[#635bff] text-white font-medium rounded-xl hover:bg-[#5048e7] transition-all active:scale-[0.98] text-sm whitespace-nowrap"
            >
              Convert to PDF
            </button>
          </div>

          {/* Optional fields */}
          <div className="mt-3 flex flex-col sm:flex-row gap-3 max-w-2xl mx-auto">
            <input
              type="password"
              placeholder="Password (if required)"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="flex-1 px-4 py-2.5 text-xs bg-white/60 border border-gray-100 rounded-lg outline-none focus:border-[#635bff]/40 text-gray-700 placeholder-gray-400"
            />
            <input
              type="email"
              placeholder="Email — unlocks gated links, PDF delivery (optional)"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="flex-1 px-4 py-2.5 text-xs bg-white/60 border border-gray-100 rounded-lg outline-none focus:border-[#635bff]/40 text-gray-700 placeholder-gray-400"
            />
            <span className="px-3 py-2.5 text-xs bg-white/60 border border-gray-100 rounded-lg text-gray-500 whitespace-nowrap">
              {auth.tier === 'member'
                ? `Member limit: ${auth.config.memberTierMaxSlides} slides`
                : `Free limit: ${auth.config.freeTierMaxSlides} slides`}
              {auth.tier !== 'member' && (
                <button
                  type="button"
                  onClick={() => setAuthModal('signup')}
                  className="ml-1 text-[#635bff] font-medium hover:underline"
                >
                  Sign in for more
                </button>
              )}
            </span>
          </div>

          {error && (
            <p className="mt-3 text-sm text-red-500">{error}</p>
          )}
        </form>
      </section>

      {/* Progress / Result */}
      {job && (
        <section className="max-w-lg mx-auto px-6 pb-12 animate-in">
          <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className={`text-xs font-medium px-2 py-1 rounded-full inline-flex items-center gap-1.5 ${
                job.status === 'completed' ? 'bg-green-50 text-green-700' :
                job.status === 'failed' ? 'bg-red-50 text-red-700' :
                'bg-blue-50 text-blue-700'
              }`}>
                {(job.status === 'pending' || job.status === 'running') && (
                  <span className="spinner" aria-hidden="true" />
                )}
                {job.status === 'pending' ? 'Starting…'
                  : job.status === 'running' ? (job.stage || 'Converting…')
                  : job.status}
              </span>
              <span className="text-xs text-gray-400">
                {job.status === 'running' && job.totalSlides
                  ? `${job.capturedSlides}/${job.totalSlides} slides`
                  : `${job.progress}%`}
              </span>
            </div>
            {(job.status === 'pending' || job.status === 'running') && (
              <>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  {job.progress > 0 ? (
                    <div className="progress-bar h-full rounded-full" style={{ width: `${job.progress}%` }} />
                  ) : (
                    // No numeric progress yet (browser launch / page load):
                    // an indeterminate shimmer still shows the job is alive.
                    <div className="progress-indeterminate h-full rounded-full" />
                  )}
                </div>
                <p className="mt-2.5 text-xs text-gray-500">
                  {job.stage || 'Queued — starting conversion…'}
                </p>
              </>
            )}
            {job.status === 'completed' && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  {job.capturedSlides} slides converted •{' '}
                  {Math.round((job.outputSizeBytes ?? 0) / 1024)} KB
                </p>
                <a
                  href={`/api/download/${job.id}`}
                  className="block w-full py-3 bg-[#635bff] text-white text-sm font-medium rounded-xl text-center hover:bg-[#5048e7] transition-all"
                >
                  Download PDF
                </a>
              </div>
            )}
            {job.status === 'failed' && job.error && (
              <div className="space-y-3">
                <p className="text-sm text-red-600">{job.error}</p>
                {job.error.includes('limited to') && auth.tier !== 'member' && (
                  <button
                    onClick={() => setAuthModal(auth.user ? 'login' : 'signup')}
                    className="block w-full py-2.5 bg-[#635bff] text-white text-sm font-medium rounded-xl hover:bg-[#5048e7] transition-all"
                  >
                    {auth.user ? 'Verify your email to unlock' : 'Sign in — convert up to 1,000 slides'}
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Pitch Deck Analysis Upsell */}
      {job?.status === 'completed' && analysis && (
        <section className="max-w-lg mx-auto px-6 pb-12 animate-in">
          <div className="bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-100 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="9" stroke="#635bff" strokeWidth="1.5"/>
                <text x="10" y="14" textAnchor="middle" fontSize="11" fill="#635bff" fontWeight="bold">A+</text>
              </svg>
              <h3 className="text-sm font-semibold text-gray-900">AI Pitch Deck Analysis</h3>
            </div>
            {analyzing && <p className="text-xs text-gray-500">Analyzing... this takes ~15 seconds</p>}
            {!analyzing && (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-white flex items-center justify-center shadow-sm">
                    <span className="text-xl font-bold text-[#635bff]">{analysis.score}/100</span>
                  </div>
                  <div className="text-xs text-gray-600">Your pitch deck scored <strong>{analysis.score}</strong>/100</div>
                </div>
                {analysis.strengths.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-green-700 mb-1">Strengths</p>
                    <ul className="text-xs text-gray-600 space-y-0.5 list-disc list-inside">
                      {analysis.strengths.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}
                {analysis.weaknesses.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-amber-700 mb-1">Improvements</p>
                    <ul className="text-xs text-gray-600 space-y-0.5 list-disc list-inside">
                      {analysis.weaknesses.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {!auth.user?.emailVerified && (
              <a
                href="#pricing"
                className="mt-4 block w-full py-2.5 border border-[#635bff] text-[#635bff] text-sm font-medium rounded-xl text-center hover:bg-[#635bff] hover:text-white transition-all"
              >
                Sign in for full access →
              </a>
            )}
          </div>
        </section>
      )}

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-3 gap-10">
          {[
            { icon: '⚡', title: 'Lightning Fast', desc: 'Convert a 20-slide deck in under 30 seconds with our optimized headless browser pipeline.' },
            { icon: '🔒', title: 'Secure by Design', desc: 'We never store your documents. Slides are processed in-memory and deleted immediately after PDF generation.' },
            { icon: '✨', title: 'Pixel Perfect', desc: 'Every slide is rendered at full resolution. What you see on screen is exactly what you get in PDF.' },
          ].map(f => (
            <div key={f.title} className="group">
              <div className="text-2xl mb-3">{f.icon}</div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">{f.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing — free vs member (no payment) */}
      <section id="pricing" className="max-w-4xl mx-auto px-6 py-20">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">Free for light use, generous for members</h2>
        <p className="text-center text-gray-500 text-sm mb-12">Sign in with Google or email — no credit card, no payment.</p>
        <div className="grid md:grid-cols-2 gap-6">
          {/* Free */}
          <div className="pricing-card bg-white border border-gray-200 rounded-2xl p-6 transition-all">
            <h3 className="font-semibold text-gray-900">Free</h3>
            <p className="text-3xl font-bold mt-2">$0<span className="text-sm font-normal text-gray-400">/forever</span></p>
            <ul className="mt-6 space-y-2 text-sm text-gray-600">
              <li>✓ Up to {auth.config.freeTierMaxSlides} slides per conversion</li>
              <li>✓ No account required</li>
              <li>✓ Standard quality PDF</li>
              <li>✓ Direct download</li>
            </ul>
            <a
              href="#top"
              className="mt-8 block w-full py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors text-center"
            >
              Start above — no sign-up
            </a>
          </div>
          {/* Member - highlighted */}
          <div className="pricing-card bg-white border-2 border-[#635bff] rounded-2xl p-6 relative transition-all shadow-lg shadow-[#635bff]/5">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-[#635bff] text-white text-xs font-medium rounded-full">
              Best for big decks
            </div>
            <h3 className="font-semibold text-gray-900">Member</h3>
            <p className="text-3xl font-bold mt-2">Free<span className="text-sm font-normal text-gray-400"> with sign-in</span></p>
            <ul className="mt-6 space-y-2 text-sm text-gray-600">
              <li>✓ Up to {auth.config.memberTierMaxSlides.toLocaleString()} slides per conversion</li>
              <li>✓ Google or email sign-in</li>
              <li>✓ Email delivery of your PDFs</li>
              <li>✓ Full pitch-deck analysis</li>
            </ul>
            {auth.user?.emailVerified ? (
              <button
                disabled
                className="mt-8 w-full py-2.5 bg-green-50 text-green-700 text-sm font-medium rounded-xl cursor-default"
              >
                ✓ You're a member
              </button>
            ) : (
              <button
                onClick={() => setAuthModal('signup')}
                className="mt-8 w-full py-2.5 bg-[#635bff] text-white text-sm font-medium rounded-xl hover:bg-[#5048e7] transition-colors"
              >
                {auth.user ? 'Verify your email' : 'Sign up free'}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 mt-20">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-400">© 2026 DocSend PDF. All rights reserved.</p>
          <div className="flex gap-6 text-xs text-gray-400">
            <a href="#" className="hover:text-gray-600">Privacy</a>
            <a href="#" className="hover:text-gray-600">Terms</a>
            <a href="#" className="hover:text-gray-600">Status</a>
          </div>
        </div>
      </footer>

      <AuthModal
        key={authModal ?? 'closed'}
        open={authModal !== null}
        initialMode={authModal ?? 'signup'}
        onClose={() => setAuthModal(null)}
      />
    </div>
  );
}

function VerifyBanner({ onResend }: { onResend: () => Promise<string | null> }) {
  const [sent, setSent] = useState(false);
  return (
    <span className="flex items-center gap-2 text-[11px] font-medium px-2 py-1 rounded-full bg-amber-50 text-amber-700">
      Verify your email to unlock member limits
      <button
        onClick={() => void onResend().then((e) => !e && setSent(true))}
        className="underline hover:no-underline"
      >
        {sent ? 'Sent ✓' : 'Resend link'}
      </button>
    </span>
  );
}
