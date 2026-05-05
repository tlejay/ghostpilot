import type { TabInfo } from '../types';

interface Props {
  tabs: TabInfo[];
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

export function TabBar({ tabs, onActivate, onClose, onNew }: Props) {
  return (
    <div className="tabs-row">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${tab.active ? 'active' : ''}`}
          onClick={() => onActivate(tab.id)}
          role="button"
        >
          {tab.loading ? <div className="tab-spinner" /> : null}
          <span className="tab-title">{tab.title || tab.url || 'New Tab'}</span>
          <button
            type="button"
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
            aria-label="Close tab"
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="tab-add" onClick={onNew} aria-label="New tab">
        +
      </button>
    </div>
  );
}
