import { forwardRef, useEffect, useState } from 'react';
import type { TabInfo } from '../types';

interface Props {
  activeTab: TabInfo | undefined;
  bookmarked: boolean;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReloadOrStop: () => void;
  onToggleBookmark: () => void;
  onToggleSidePanel: () => void;
  onMediaClick: () => void;
  sidePanelOpen: boolean;
  profile: string;
  mcpStatus: 'ok' | 'unknown';
}

export const AddressBar = forwardRef<HTMLInputElement, Props>(function AddressBar(
  {
    activeTab,
    bookmarked,
    onNavigate,
    onBack,
    onForward,
    onReloadOrStop,
    onToggleBookmark,
    onToggleSidePanel,
    onMediaClick,
    sidePanelOpen,
    profile,
    mcpStatus,
  },
  ref,
) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(activeTab?.url ?? '');
  }, [activeTab?.url, editing]);

  return (
    <form
      className="address-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) onNavigate(draft);
        setEditing(false);
        (e.target as HTMLFormElement).querySelector('input')?.blur();
      }}
    >
      <button
        type="button"
        className="nav-btn"
        disabled={!activeTab?.canGoBack}
        onClick={onBack}
        aria-label="Back"
      >
        ←
      </button>
      <button
        type="button"
        className="nav-btn"
        disabled={!activeTab?.canGoForward}
        onClick={onForward}
        aria-label="Forward"
      >
        →
      </button>
      <button
        type="button"
        className="nav-btn"
        onClick={onReloadOrStop}
        aria-label={activeTab?.loading ? 'Stop' : 'Reload'}
      >
        {activeTab?.loading ? '×' : '↻'}
      </button>

      <div className={`address-bar-wrap ${editing ? 'focused' : ''}`}>
        <input
          ref={ref}
          className="address-bar"
          value={draft}
          placeholder="Search Google or type a URL"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => {
            setEditing(true);
            e.currentTarget.select();
          }}
          onBlur={() => setEditing(false)}
        />
        <button
          type="button"
          className="star-btn media-pill-btn"
          onClick={onMediaClick}
          aria-label="Show downloadable media on this page"
          title="Show downloadable media on this page"
        >
          🎬
        </button>
        <button
          type="button"
          className={`star-btn ${bookmarked ? 'active' : ''}`}
          onClick={onToggleBookmark}
          disabled={!activeTab}
          aria-label={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
          title={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
        >
          {bookmarked ? '★' : '☆'}
        </button>
      </div>

      <button
        type="button"
        className={`nav-btn ${sidePanelOpen ? 'active' : ''}`}
        onClick={onToggleSidePanel}
        aria-label="Toggle side panel"
        title="History · Bookmarks · Downloads · Media (Cmd+B)"
      >
        ☰
      </button>

      <div className="profile-badge" title="Active profile (set with AI_BROWSER_PROFILE)">
        👤 {profile}
      </div>
      <div
        className="mcp-badge"
        title="Claude CLI can drive this browser via the embedded MCP server"
      >
        <div className="mcp-dot" style={{ background: mcpStatus === 'ok' ? '#34a853' : '#ea4335' }} />
        MCP
      </div>
    </form>
  );
});
