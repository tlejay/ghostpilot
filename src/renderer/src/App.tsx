import { useEffect, useMemo, useRef, useState } from 'react';
import { TabBar } from './components/TabBar';
import { AddressBar } from './components/AddressBar';
import { FindBar } from './components/FindBar';
import { SidePanel, type SidePanelTab } from './components/SidePanel';
import { UpdateBanner } from './components/UpdateBanner';
import type { TabInfo } from './types';

export function App() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [bookmarked, setBookmarked] = useState(false);
  const [profile, setProfile] = useState('default');
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState<SidePanelTab>('bookmarks');
  const [findOpen, setFindOpen] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);

  const activeTab = useMemo(() => tabs.find((t) => t.active), [tabs]);

  // Tell the main process whenever the chrome region's height changes — the
  // banner pushes everything down ~30px, and the WebContentsView needs to
  // shift to match.
  useEffect(() => {
    if (!chromeRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = Math.round(entry.contentRect.height);
        window.api.tabs.setToolbarHeight(h);
      }
    });
    observer.observe(chromeRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    window.api.tabs.list().then(setTabs);
    window.api.profile.current().then(setProfile);
    return window.api.tabs.onUpdated(setTabs);
  }, []);

  useEffect(() => {
    if (!activeTab?.url) {
      setBookmarked(false);
      return;
    }
    window.api.bookmarks.has(activeTab.url).then(setBookmarked);
  }, [activeTab?.url]);

  useEffect(() => {
    const offFocus = window.api.events.onFocusAddressBar(() => {
      addressRef.current?.focus();
      addressRef.current?.select();
    });
    const offToggle = window.api.events.onToggleSidePanel(() => {
      setSidePanelOpen((open) => !open);
    });
    const offFind = window.api.events.onOpenFindBar(() => setFindOpen(true));
    return () => {
      offFocus();
      offToggle();
      offFind();
    };
  }, []);

  // Tell the main process to shrink the WebContentsView when the side panel
  // opens, otherwise the page renders on top of the panel and hides it.
  useEffect(() => {
    window.api.tabs.setSidePanelWidth(sidePanelOpen ? 360 : 0);
  }, [sidePanelOpen]);

  const navigate = (url: string) => {
    if (!activeTab) {
      window.api.tabs.open(url);
    } else {
      window.api.tabs.navigate(activeTab.id, url);
    }
  };

  const toggleBookmark = async () => {
    if (!activeTab?.url) return;
    if (bookmarked) {
      await window.api.bookmarks.removeByUrl(activeTab.url);
      setBookmarked(false);
    } else {
      await window.api.bookmarks.add(activeTab.url, activeTab.title || activeTab.url);
      setBookmarked(true);
    }
  };

  return (
    <>
      <div className="chrome" ref={chromeRef}>
        <UpdateBanner />
        <TabBar
          tabs={tabs}
          onActivate={(id) => window.api.tabs.activate(id)}
          onClose={(id) => window.api.tabs.close(id)}
          onNew={() => window.api.tabs.open()}
          onPin={(id) => window.api.tabs.pin(id)}
          onUnpin={(id) => window.api.tabs.unpin(id)}
          onReorder={(id, index) => window.api.tabs.reorder(id, index)}
        />
        {findOpen && (
          <FindBar tabId={activeTab?.id} onClose={() => setFindOpen(false)} />
        )}
        <AddressBar
          ref={addressRef}
          activeTab={activeTab}
          bookmarked={bookmarked}
          onNavigate={navigate}
          onBack={() => activeTab && window.api.tabs.back(activeTab.id)}
          onForward={() => activeTab && window.api.tabs.forward(activeTab.id)}
          onReloadOrStop={() => {
            if (!activeTab) return;
            if (activeTab.loading) window.api.tabs.stop(activeTab.id);
            else window.api.tabs.reload(activeTab.id);
          }}
          onToggleBookmark={toggleBookmark}
          onToggleSidePanel={() => setSidePanelOpen((o) => !o)}
          onMediaClick={() => {
            setSidePanelTab('media');
            setSidePanelOpen(true);
          }}
          sidePanelOpen={sidePanelOpen}
          profile={profile}
          mcpStatus="ok"
        />
      </div>
      {sidePanelOpen ? (
        <SidePanel
          active={sidePanelTab}
          onChange={setSidePanelTab}
          onClose={() => setSidePanelOpen(false)}
          onOpenUrl={(url) => {
            navigate(url);
            setSidePanelOpen(false);
          }}
          activeTab={activeTab}
        />
      ) : null}
    </>
  );
}
