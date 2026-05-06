import React, { useRef, type FormEvent, type SVGProps } from 'react';
import { createRoot } from 'react-dom/client';
import { GhostIcon } from './components/GhostIcon';
import './styles/newtab.css';

interface Prompt {
  label: string;
  text: string;
}

const prompts: Prompt[] = [
  { label: 'Browse', text: 'Open YouTube and search for lo-fi music' },
  { label: 'Capture', text: 'Take a screenshot of the active tab' },
  { label: 'Summarize', text: 'Summarize the content of this page' },
  { label: 'Recall', text: 'Which sites did I visit yesterday?' },
  { label: 'Download', text: 'Download the video playing on this page' },
  { label: 'Inspect', text: 'List network requests slower than one second' },
];

interface Capability {
  title: string;
  desc: string;
  icon: (props: SVGProps<SVGSVGElement>) => JSX.Element;
}

function IconTabs(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
function IconCapture(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
function IconCode(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}
function IconNetwork(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15 15 0 0 1 0 20" />
      <path d="M12 2a15 15 0 0 0 0 20" />
    </svg>
  );
}
function IconDownload(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
function IconUser(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function IconSparkle(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3l2.4 5.4L20 11l-5.6 2.6L12 19l-2.4-5.4L4 11l5.6-2.6z" />
      <path d="M19 3l.7 1.7L21 5.4l-1.3.7L19 8l-.7-1.9L17 5.4l1.3-.7z" />
    </svg>
  );
}
function IconPhone(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="6" y="2" width="12" height="20" rx="3" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
  );
}
function IconTerminal(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}
function IconCloud(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8 6 6 0 1 0-11.1 3.3" />
      <path d="M5 19h12.5" />
    </svg>
  );
}

const moats: Capability[] = [
  {
    title: 'Mobile-ready connector',
    desc: 'Control this browser from Claude on iPhone, iPad, or web — not just desktop. Chrome, Arc, and Dia can\'t.',
    icon: IconPhone,
  },
  {
    title: 'Self-learning skills',
    desc: 'After every task, Claude can save the steps to a skill registry. The next run skips trial-and-error and just runs.',
    icon: IconSparkle,
  },
];

const capabilities: Capability[] = [
  { title: 'Tab control', desc: 'Open, close, navigate, switch — all from a Claude prompt.', icon: IconTabs },
  { title: 'Screenshots', desc: 'Capture full pages or specific selectors for sharing.', icon: IconCapture },
  { title: 'Run JavaScript', desc: 'Click, fill, scrape, evaluate — anything DevTools can do.', icon: IconCode },
  { title: 'Network + console', desc: 'Replay requests, surface slow calls, read the JS console.', icon: IconNetwork },
  { title: 'Download videos', desc: 'Grab any video or audio that plays on a webpage.', icon: IconDownload },
  { title: 'Profiles', desc: 'Switch work / personal — separate cookies and storage.', icon: IconUser },
];

function navigateToSearch(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return;
  if (/^[a-z]+:\/\//i.test(trimmed)) {
    window.location.href = trimmed;
    return;
  }
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(trimmed)) {
    window.location.href = `https://${trimmed}`;
    return;
  }
  window.location.href = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function NewTab() {
  const inputRef = useRef<HTMLInputElement>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    navigateToSearch(inputRef.current?.value ?? '');
  }

  return (
    <div className="welcome">
      <div className="welcome-icon">
        <GhostIcon size={116} />
      </div>
      <h1 className="welcome-title">GhostPilot</h1>
      <p className="welcome-tagline">
        A Mac browser that Claude can pilot — through the CLI on this machine, or
        through Claude on your phone via the Model Context Protocol.
      </p>

      <form className="welcome-search-form" onSubmit={onSubmit}>
        <span className="welcome-search-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          ref={inputRef}
          className="welcome-search-input"
          type="text"
          placeholder="Search Google or paste a URL"
          autoFocus
        />
        <span className="welcome-search-hint">↵</span>
      </form>

      <div className="welcome-section">
        <p className="welcome-section-label">Why GhostPilot</p>
        <div className="moat-grid">
          {moats.map((m) => {
            const Icon = m.icon;
            return (
              <div className="moat-card" key={m.title}>
                <div className="moat-icon">
                  <Icon />
                </div>
                <div className="moat-text">
                  <span className="moat-title">{m.title}</span>
                  <span className="moat-desc">{m.desc}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="welcome-section">
        <p className="welcome-section-label">What I can do</p>
        <div className="cap-grid">
          {capabilities.map((c) => {
            const Icon = c.icon;
            return (
              <div className="cap-card" key={c.title}>
                <div className="cap-icon">
                  <Icon />
                </div>
                <div className="cap-text">
                  <span className="cap-title">{c.title}</span>
                  <span className="cap-desc">{c.desc}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="welcome-section">
        <p className="welcome-section-label">Try asking Claude</p>
        <div className="prompt-grid">
          {prompts.map((p) => (
            <div className="prompt-card" key={p.text}>
              <span className="prompt-card-label">{p.label}</span>
              <span className="prompt-card-text">{p.text}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="welcome-section">
        <p className="welcome-section-label">Connect Claude</p>
        <div className="setup-grid">
          <div className="setup-card">
            <div className="setup-card-head">
              <div className="setup-icon">
                <IconTerminal />
              </div>
              <div>
                <h3 className="setup-title">Claude Code (terminal)</h3>
                <p className="setup-sub">One command, works immediately on this Mac.</p>
              </div>
            </div>
            <pre className="setup-code">
              <code>claude mcp add --transport http ghostpilot http://127.0.0.1:9223/mcp</code>
            </pre>
            <p className="setup-foot">
              That's it — open a Claude Code session and ask it to drive the browser.
            </p>
          </div>

          <div className="setup-card">
            <div className="setup-card-head">
              <div className="setup-icon">
                <IconCloud />
              </div>
              <div>
                <h3 className="setup-title">Claude.ai &amp; iPhone app</h3>
                <p className="setup-sub">
                  Pilot this browser from anywhere — desktop, web, iPhone, iPad.
                </p>
              </div>
            </div>
            <ol className="setup-steps">
              <li>
                Install a tunnel: <code>brew install cloudflared</code>
              </li>
              <li>
                Set a password — keep this private:
                <pre className="setup-code setup-code-inline">
                  <code>export GHOSTPILOT_OAUTH_PASSWORD=&quot;...&quot;</code>
                </pre>
              </li>
              <li>
                Start GhostPilot, then open the tunnel:
                <pre className="setup-code setup-code-inline">
                  <code>cloudflared tunnel --url http://127.0.0.1:9223</code>
                </pre>
              </li>
              <li>
                In Claude → Settings → Connectors → Add custom connector, paste{' '}
                <code>https://&lt;your-tunnel&gt;.trycloudflare.com/mcp</code>, and
                authorize with the password above.
              </li>
            </ol>
          </div>
        </div>
      </div>

      <div className="welcome-footer">
        <button
          type="button"
          className="welcome-footer-link"
          onClick={() => window.api?.app.openAbout()}
        >
          About GhostPilot
        </button>
        <span>from madebytle.com · MIT</span>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Root container not found');
createRoot(container).render(
  <React.StrictMode>
    <NewTab />
  </React.StrictMode>,
);
