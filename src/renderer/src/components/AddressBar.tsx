import { forwardRef, useEffect, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowPathIcon,
  XMarkIcon,
  FilmIcon,
  BookmarkIcon as BookmarkOutline,
  Bars3Icon,
} from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolid } from '@heroicons/react/24/solid';
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
  const [profileOpen, setProfileOpen] = useState(false);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [newProfile, setNewProfile] = useState('');
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileOpen) return;
    window.api.profile.list().then(setProfiles);
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [profileOpen]);

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
        <ArrowLeftIcon className="icon" />
      </button>
      <button
        type="button"
        className="nav-btn"
        disabled={!activeTab?.canGoForward}
        onClick={onForward}
        aria-label="Forward"
      >
        <ArrowRightIcon className="icon" />
      </button>
      <button
        type="button"
        className="nav-btn"
        onClick={onReloadOrStop}
        aria-label={activeTab?.loading ? 'Stop' : 'Reload'}
      >
        {activeTab?.loading ? <XMarkIcon className="icon" /> : <ArrowPathIcon className="icon" />}
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
          <FilmIcon className="icon" />
        </button>
        <button
          type="button"
          className={`star-btn ${bookmarked ? 'active' : ''}`}
          onClick={onToggleBookmark}
          disabled={!activeTab}
          aria-label={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
          title={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
        >
          {bookmarked ? <BookmarkSolid className="icon" /> : <BookmarkOutline className="icon" />}
        </button>
      </div>

      <button
        type="button"
        className={`nav-btn ${sidePanelOpen ? 'active' : ''}`}
        onClick={onToggleSidePanel}
        aria-label="Toggle side panel"
        title="History · Bookmarks · Downloads · Media (Cmd+B)"
      >
        <Bars3Icon className="icon" />
      </button>

      <div className="profile-badge-wrap" ref={profileRef}>
        <button
          type="button"
          className="profile-badge"
          title={`Profile: ${profile} — click to switch`}
          onClick={() => setProfileOpen((o) => !o)}
        >
          <span className="profile-avatar">{profile[0].toUpperCase()}</span>
          <span className="profile-name">{profile}</span>
        </button>
        {profileOpen && (
          <div className="profile-dropdown">
            {profiles.filter((p) => p !== profile).map((p) => (
              <button
                key={p}
                type="button"
                className="profile-option"
                onClick={() => window.api.profile.switch(p)}
              >
                {p}
              </button>
            ))}
            <div className="profile-new">
              <input
                placeholder="New profile…"
                value={newProfile}
                onChange={(e) => setNewProfile(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newProfile.trim()) {
                    window.api.profile.switch(newProfile.trim());
                  }
                }}
              />
            </div>
          </div>
        )}
      </div>
      <div
        className="mcp-dot-only"
        title={`MCP ${mcpStatus === 'ok' ? 'connected' : 'disconnected'} — Claude CLI can drive this browser`}
        style={{ background: mcpStatus === 'ok' ? '#34a853' : '#ea4335' }}
      />
    </form>
  );
});
