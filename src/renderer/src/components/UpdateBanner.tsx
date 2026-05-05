import { useEffect, useState } from 'react';
import type { AutoUpdateState } from '../types';

export function UpdateBanner() {
  const [state, setState] = useState<AutoUpdateState>({ stage: 'idle' });

  useEffect(() => {
    window.api.autoUpdate.state().then(setState);
    return window.api.autoUpdate.onState(setState);
  }, []);

  // Silent for idle / checking / not-available / available / error.
  // Only intrude on the user when there's something they actually need to do:
  // a download is actively in progress, or an update is ready to install.
  // Errors and "no release published yet" surface only via the GhostPilot →
  // Check for Updates… menu item, not as a banner.

  if (state.stage === 'downloading') {
    return (
      <div className="update-banner">
        <span className="update-banner-dot" />
        <span className="update-banner-text">
          Downloading GhostPilot {state.version ?? ''}
          {state.progressPercent != null ? ` — ${state.progressPercent}%` : '…'}
        </span>
      </div>
    );
  }

  if (state.stage === 'downloaded') {
    return (
      <div className="update-banner update-banner-ready">
        <span className="update-banner-dot ready" />
        <span className="update-banner-text">
          GhostPilot {state.version} is ready to install.
        </span>
        <button
          type="button"
          className="update-banner-cta"
          onClick={() => window.api.autoUpdate.install()}
        >
          Restart to update
        </button>
        <button
          type="button"
          className="update-banner-link"
          onClick={() => window.api.autoUpdate.openReleaseNotes(state.version)}
        >
          What's new
        </button>
      </div>
    );
  }

  return null;
}
