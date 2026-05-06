---
name: facebook-search-friend
description: Navigate to a Facebook friend's profile using ghostpilot MCP tools. Use when the user says "เปิด Facebook แล้วไปที่เพื่อน [ชื่อ]" or "find [name] on Facebook".
---

# Facebook → Friend Profile via GhostPilot

Exact steps to open Facebook and land on a friend's profile. Follow in order — no guessing needed.

## Step 1: Load required tool schemas

```
ToolSearch: select:mcp__ghostpilot__new_tab,mcp__ghostpilot__wait_for_selector,mcp__ghostpilot__click,mcp__ghostpilot__type_text,mcp__ghostpilot__evaluate,mcp__ghostpilot__screenshot,mcp__ghostpilot__press_key
```

## Step 2: Navigate directly to People search (fastest path)

URL-encode the name and navigate straight to the search results — skips the search bar, dropdown, and dialog entirely:

```
mcp__ghostpilot__navigate  url="https://www.facebook.com/search/people/?q=<URL-encoded name>"
```

Example: "Mark Zuckerberg" → `https://www.facebook.com/search/people/?q=Mark%20Zuckerberg`

If Facebook isn't open yet, use `new_tab` instead of `navigate`.

## Step 3: Wait for results

```
mcp__ghostpilot__wait_for_selector  selector="div[role='article']"  timeoutMs=10000
```

## Step 4: Screenshot to confirm the right person

```
mcp__ghostpilot__screenshot
```

Verify it's the right person before clicking.

## Step 5: Click the profile card

```
mcp__ghostpilot__click  selector="div[role='article'] a"
```

## Step 6: Screenshot to confirm

```
mcp__ghostpilot__screenshot
```

---

## Fallback: search bar method (if direct URL doesn't work)

Use only if the direct URL path above fails.

### F1: Dismiss "Remember password" dialog

```javascript
// mcp__ghostpilot__evaluate
(function(){
  const buttons = document.querySelectorAll('div[role="button"]');
  for (const btn of buttons) {
    if (btn.textContent.trim() === 'Not now') { btn.click(); return 'dismissed'; }
  }
  return 'no dialog';
})()
```

### F2: Type in search bar (use `type_text`, NOT `fill`)

```
mcp__ghostpilot__click       selector="input[aria-label='Search Facebook']"
mcp__ghostpilot__type_text   text="<friend name>"
mcp__ghostpilot__press_key   key="Return"
```

### F3: Click top result on search page

```
mcp__ghostpilot__wait_for_selector  selector="div[role='article']"  timeoutMs=8000
mcp__ghostpilot__click              selector="div[role='article'] a"
```

## Common pitfalls

| Problem | Fix |
|---------|-----|
| `h2 a, div[role='link']` clicks wrong element | Use `div[role='article'] a` — more specific to the person card |
| Clicking search result opens wrong page (e.g. Friends tab) | Use direct URL `/search/people/?q=` instead |
| `fill` doesn't trigger autocomplete | Use `type_text` instead |
| Dialog blocks interaction | Run the JS evaluate (Fallback F1) first |
