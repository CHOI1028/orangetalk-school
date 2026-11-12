// Provider Search Suggestions are isolated from the app. No scripts/forms/network styles.
export function appendSearchSuggestions(target, snippets, openExternal) {
  for (const html of (Array.isArray(snippets) ? snippets : []).slice(0, 5)) {
    if (typeof html !== 'string' || html.length > 60000) continue;
    // Reject executable/navigation markup instead of changing Google's visible widget.
    if (/<(?:script|iframe|object|embed|base|meta|form|input|link)\b|\bon[a-z]+\s*=|(?:javascript|vbscript|file):|@import/i.test(html)) continue;
    const frame = document.createElement('iframe');
    frame.className = 'school-ai-search-suggestions'; frame.title = 'Google 검색 제안';
    frame.setAttribute('sandbox', 'allow-same-origin'); frame.referrerPolicy = 'no-referrer';
    frame.addEventListener('load', () => {
      try {
        const doc = frame.contentDocument;
        doc.addEventListener('click', event => {
          const link = event.target.closest('a'); if (!link) return;
          event.preventDefault();
          try { const url = new URL(link.href); if (url.protocol === 'https:' && !url.username && !url.password && !/^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname)) openExternal(url.href); } catch (_) {}
        });
        frame.style.height = Math.min(220, Math.max(64, doc.body.scrollHeight + 12)) + 'px';
      } catch (_) {}
    });
    frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src data: https://www.gstatic.com; form-action \'none\'; base-uri \'none\'"><style>body{margin:6px;font:12px sans-serif;overflow-wrap:anywhere}</style></head><body>' + html + '</body></html>';
    target.append(frame);
  }
}
