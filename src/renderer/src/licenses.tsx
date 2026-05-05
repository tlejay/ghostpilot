import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/legal.css';

interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  author?: string;
  homepage?: string;
  description?: string;
  licenseText?: string;
}

function Licenses() {
  const [entries, setEntries] = useState<LicenseEntry[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    window.api.app.notices().then(setEntries);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return entries;
    const q = query.toLowerCase();
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.license.toLowerCase().includes(q) ||
        (e.author ?? '').toLowerCase().includes(q),
    );
  }, [entries, query]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) map.set(e.license, (map.get(e.license) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  return (
    <div className="licenses-page">
      <header className="licenses-header">
        <div className="licenses-header-text">
          <h1>Open Source Licenses</h1>
          <p>
            GhostPilot is built on the work of many open-source authors. We are grateful — and required by their licenses to credit them.
          </p>
          <div className="licenses-summary-counts">
            {counts.map(([license, count]) => (
              <span key={license} className="licenses-count-pill">
                {license}: {count}
              </span>
            ))}
          </div>
        </div>
      </header>

      <div className="licenses-search-wrap">
        <input
          className="licenses-search"
          placeholder={`Search ${entries.length} packages…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="licenses-body">
        {filtered.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#80868b', padding: '32px 0' }}>
            {entries.length === 0 ? 'Loading…' : 'No matches.'}
          </p>
        ) : (
          filtered.map((e) => (
            <details key={`${e.name}@${e.version}`} className="license-card">
              <summary className="license-summary">
                <span className="license-name">{e.name}</span>
                <span className="license-version">{e.version}</span>
                <span className="license-badge">{e.license}</span>
              </summary>
              <div className="license-detail">
                <dl className="license-meta">
                  {e.author ? (
                    <>
                      <dt>Author</dt>
                      <dd>{e.author}</dd>
                    </>
                  ) : null}
                  {e.homepage ? (
                    <>
                      <dt>Homepage</dt>
                      <dd>
                        <a
                          href={e.homepage}
                          onClick={(ev) => {
                            ev.preventDefault();
                            window.api.app.openExternal(e.homepage!);
                          }}
                        >
                          {e.homepage}
                        </a>
                      </dd>
                    </>
                  ) : null}
                  {e.description ? (
                    <>
                      <dt>Description</dt>
                      <dd>{e.description}</dd>
                    </>
                  ) : null}
                </dl>
                {e.licenseText ? (
                  <pre className="license-text">{e.licenseText}</pre>
                ) : (
                  <p className="license-text-empty">
                    No license file shipped with this package — the package's declared license
                    ({e.license}) governs.
                  </p>
                )}
              </div>
            </details>
          ))
        )}
      </div>

      <footer className="licenses-footer">
        Generated at build time by <code>pnpm licenses list --prod</code>.
      </footer>
    </div>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Root container not found');
createRoot(container).render(
  <React.StrictMode>
    <Licenses />
  </React.StrictMode>,
);
