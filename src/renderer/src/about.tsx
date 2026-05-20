import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GhostIcon } from './components/GhostIcon';
import './styles/legal.css';
import pkg from '../../../package.json';

interface AppInfo {
  name: string;
  version: string;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
}

function About() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    window.api.app.info().then(setInfo);
  }, []);

  return (
    <>
      <div className="drag-region" />
      <div className="about">
        <GhostIcon size={132} />
        <h1 className="about-name">{info?.name ?? 'GhostPilot'}</h1>
        <p className="about-version">Version {info?.version ?? pkg.version}</p>
        <p className="about-tagline">
          A Chrome-like Mac browser with an embedded MCP server, so Claude can pilot your
          everyday browsing.
        </p>

        <a
          className="about-link"
          onClick={(e) => {
            e.preventDefault();
            window.api.app.openExternal('https://madebytle.com');
          }}
          href="https://madebytle.com"
        >
          🌐 from madebytle.com
        </a>

        <button
          type="button"
          className="about-licenses-link"
          onClick={() => window.api.app.openLicenses()}
        >
          View Open Source Licenses
        </button>

        {info ? (
          <p className="about-meta">
            GhostPilot {info.version} · Chromium {info.chromeVersion} · Node{' '}
            {info.nodeVersion}
          </p>
        ) : null}

        <p className="about-copyright">© 2026 Tle · MIT License</p>
      </div>
    </>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Root container not found');
createRoot(container).render(
  <React.StrictMode>
    <About />
  </React.StrictMode>,
);
