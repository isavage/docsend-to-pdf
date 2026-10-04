import { useState } from 'react';
import './index.css';

interface ConversionJob {
  id: string;
  url: string;
  password?: string;
  tier: 'free' | 'paid';
  email?: string;
  status: string;
  progress: number;
  totalSlides?: number;
  capturedSlides: number;
  outputPath?: string;
  outputSizeBytes?: number;
  error?: string;
}

export default function App() {
  const [url, setUrl] = useState('');
  const [password, setPassword] = useState('');
  const [tier, setTier] = useState<'free' | 'paid'>('free');
  const [email, setEmail] = useState('');
  const [job, setJob] = useState<ConversionJob | null>(null);
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<{ score: number; strengths: string[]; weaknesses: string[] } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url || !url.startsWith('http')) return setError('Please enter a valid DocSend URL');

    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, password: password || undefined, tier, email: email || undefined }),
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
    evtSource.onerror = () => evtSource.close();
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
            <a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-gray-900 transition-colors">GitHub</a>
          </nav>
          <button className="px-4 py-2 bg-[#635bff] text-white text-sm font-medium rounded-full hover:bg-[#5048e7] transition-colors">
            Sign Up
          </button>
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
              placeholder="Email for delivery (optional)"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="flex-1 px-4 py-2.5 text-xs bg-white/60 border border-gray-100 rounded-lg outline-none focus:border-[#635bff]/40 text-gray-700 placeholder-gray-400"
            />
            <select
              value={tier}
              onChange={e => setTier(e.target.value as 'free' | 'paid')}
              className="px-3 py-2.5 text-xs bg-white/60 border border-gray-100 rounded-lg outline-none text-gray-500 cursor-pointer"
            >
              <option value="free">Free</option>
              <option value="paid">Paid</option>
            </select>
          </div>

          {error && (
            <p className="mt-3 text-sm text-red-500">{error}</p>
          )}
        </form>
      </section>

      {/* Progress / Result */}
      {job && job.status !== 'pending' && (
        <section className="max-w-lg mx-auto px-6 pb-12 animate-in">
          <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                job.status === 'completed' ? 'bg-green-50 text-green-700' :
                job.status === 'failed' ? 'bg-red-50 text-red-700' :
                'bg-blue-50 text-blue-700'
              }`}>
                {job.status === 'running' ? 'Converting...' : job.status}
              </span>
              <span className="text-xs text-gray-400">{job.progress}%</span>
            </div>
            {job.status === 'running' && (
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="progress-bar h-full rounded-full" style={{ width: `${job.progress}%` }} />
              </div>
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
              <p className="text-sm text-red-600">{job.error}</p>
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
            <a
              href="#pricing"
              className="mt-4 block w-full py-2.5 border border-[#635bff] text-[#635bff] text-sm font-medium rounded-xl text-center hover:bg-[#635bff] hover:text-white transition-all"
            >
              Unlock full AI analysis →
            </a>
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

      {/* Pricing */}
      <section id="pricing" className="max-w-5xl mx-auto px-6 py-20">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">Simple pricing</h2>
        <p className="text-center text-gray-500 text-sm mb-12">Start free. Upgrade when you need more.</p>
        <div className="grid md:grid-cols-3 gap-6">
          {/* Free */}
          <div className="pricing-card bg-white border border-gray-200 rounded-2xl p-6 transition-all">
            <h3 className="font-semibold text-gray-900">Free</h3>
            <p className="text-3xl font-bold mt-2">$0<span className="text-sm font-normal text-gray-400">/mo</span></p>
            <ul className="mt-6 space-y-2 text-sm text-gray-600">
              <li>✓ Up to 10 slides per conversion</li>
              <li>✓ Standard quality PDF</li>
              <li>✓ Direct download</li>
              <li>✗ No batch conversions</li>
              <li>✗ No email delivery</li>
              <li>✗ No AI analysis</li>
            </ul>
            <button className="mt-8 w-full py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
              Start Free
            </button>
          </div>
          {/* Pro - highlighted */}
          <div className="pricing-card bg-white border-2 border-[#635bff] rounded-2xl p-6 relative transition-all shadow-lg shadow-[#635bff]/5">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-[#635bff] text-white text-xs font-medium rounded-full">
              Most Popular
            </div>
            <h3 className="font-semibold text-gray-900">Pro</h3>
            <p className="text-3xl font-bold mt-2">$12<span className="text-sm font-normal text-gray-400">/mo</span></p>
            <ul className="mt-6 space-y-2 text-sm text-gray-600">
              <li>✓ Unlimited slides</li>
              <li>✓ High-quality PDF</li>
              <li>✓ Email delivery</li>
              <li>✓ Batch conversions</li>
              <li>✓ AI pitch-deck analysis</li>
              <li>✓ Priority support</li>
            </ul>
            <button className="mt-8 w-full py-2.5 bg-[#635bff] text-white text-sm font-medium rounded-xl hover:bg-[#5048e7] transition-colors">
              Get Pro
            </button>
          </div>
          {/* Enterprise */}
          <div className="pricing-card bg-white border border-gray-200 rounded-2xl p-6 transition-all">
            <h3 className="font-semibold text-gray-900">Team</h3>
            <p className="text-3xl font-bold mt-2">$39<span className="text-sm font-normal text-gray-400">/mo</span></p>
            <ul className="mt-6 space-y-2 text-sm text-gray-600">
              <li>✓ Everything in Pro</li>
              <li>✓ API access</li>
              <li>✓ SSO / SAML</li>
              <li>✓ Audit logs</li>
              <li>✓ Dedicated account manager</li>
              <li>✓ Custom SLAs</li>
            </ul>
            <button className="mt-8 w-full py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
              Contact Sales
            </button>
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
    </div>
  );
}
