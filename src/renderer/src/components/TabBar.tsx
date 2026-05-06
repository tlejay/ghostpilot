import { useRef } from 'react';
import type { TabInfo } from '../types';

interface Props {
  tabs: TabInfo[];
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onPin: (id: string) => void;
  onUnpin: (id: string) => void;
  onReorder: (id: string, toIndex: number) => void;
}

export function TabBar({ tabs, onActivate, onClose, onNew, onPin, onUnpin, onReorder }: Props) {
  const dragId = useRef<string | null>(null);

  return (
    <div className="tabs-row">
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          className={`tab ${tab.active ? 'active' : ''} ${tab.pinned ? 'pinned' : ''}`}
          onClick={() => onActivate(tab.id)}
          role="button"
          draggable
          onDragStart={() => { dragId.current = tab.id; }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragId.current && dragId.current !== tab.id) {
              onReorder(dragId.current, index);
              dragId.current = null;
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (tab.pinned) onUnpin(tab.id);
            else onPin(tab.id);
          }}
          title={tab.pinned ? 'Right-click to unpin' : 'Right-click to pin'}
        >
          {tab.pinned && <span className="tab-pin">📌</span>}
          {tab.loading ? (
            <div className="tab-spinner" />
          ) : tab.favicon ? (
            <img className="tab-favicon" src={tab.favicon} alt="" />
          ) : null}
          <span className="tab-title">{tab.title || tab.url || 'New Tab'}</span>
          {!tab.pinned && (
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
          )}
        </div>
      ))}
      <button type="button" className="tab-add" onClick={onNew} aria-label="New tab">
        +
      </button>
    </div>
  );
}
