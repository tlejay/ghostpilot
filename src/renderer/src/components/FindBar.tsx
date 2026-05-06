import { useEffect, useRef, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface Props {
  tabId: string | undefined;
  onClose: () => void;
}

export function FindBar({ tabId, onClose }: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (!tabId || !query.trim()) {
      if (tabId) window.api.tabs.findStop(tabId);
      return;
    }
    window.api.tabs.find(tabId, query);
  }, [query, tabId]);

  const close = () => {
    if (tabId) window.api.tabs.findStop(tabId);
    onClose();
  };

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        className="find-input"
        placeholder="Find in page…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'Enter') {
            if (tabId && query.trim()) window.api.tabs.find(tabId, query);
          }
        }}
      />
      <button type="button" className="find-close" onClick={close} aria-label="Close find bar">
        <XMarkIcon className="icon" />
      </button>
    </div>
  );
}
