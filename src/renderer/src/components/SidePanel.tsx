import { HistoryPanel } from '../panels/HistoryPanel';
import { BookmarksPanel } from '../panels/BookmarksPanel';
import { DownloadsPanel } from '../panels/DownloadsPanel';
import { MediaPanel } from '../panels/MediaPanel';
import type { TabInfo } from '../types';

export type SidePanelTab = 'media' | 'history' | 'bookmarks' | 'downloads';

interface Props {
  active: SidePanelTab;
  onChange: (tab: SidePanelTab) => void;
  onClose: () => void;
  onOpenUrl: (url: string) => void;
  activeTab: TabInfo | undefined;
}

const TABS: { key: SidePanelTab; label: string }[] = [
  { key: 'media', label: 'Media' },
  { key: 'history', label: 'History' },
  { key: 'bookmarks', label: 'Bookmarks' },
  { key: 'downloads', label: 'Downloads' },
];

export function SidePanel({ active, onChange, onClose, onOpenUrl, activeTab }: Props) {
  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`side-panel-tab ${active === t.key ? 'active' : ''}`}
            onClick={() => onChange(t.key)}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className="side-panel-close"
          onClick={onClose}
          aria-label="Close panel"
        >
          ×
        </button>
      </div>
      <div className="side-panel-body">
        {active === 'media' ? <MediaPanel activeTab={activeTab} /> : null}
        {active === 'history' ? <HistoryPanel onOpen={onOpenUrl} /> : null}
        {active === 'bookmarks' ? <BookmarksPanel onOpen={onOpenUrl} /> : null}
        {active === 'downloads' ? <DownloadsPanel /> : null}
      </div>
    </aside>
  );
}
