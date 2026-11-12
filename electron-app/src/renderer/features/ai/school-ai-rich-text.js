// Render a small Markdown subset using DOM nodes only; model HTML is always text.
export function renderAiText(target, text) {
  target.replaceChildren();
  const inline = (node, value) => {
    for (const part of value.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)) {
      if (!part) continue;
      const tag = part.startsWith('**') && part.endsWith('**') ? 'strong' : part.startsWith('`') && part.endsWith('`') ? 'code' : null;
      const child = tag ? document.createElement(tag) : document.createTextNode(part);
      if (tag) child.textContent = part.slice(tag === 'strong' ? 2 : 1, tag === 'strong' ? -2 : -1);
      node.append(child);
    }
  };
  let list, paragraph;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) { list = paragraph = null; continue; }
    const item = line.match(/^\s*(?:([-*•])|\d+[.)])\s+(.+)$/);
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (item) {
      const tag = item[1] ? 'UL' : 'OL';
      if (!list || list.tagName !== tag) { list = document.createElement(tag); target.append(list); }
      const li = document.createElement('li'); inline(li, item[2]); list.append(li); paragraph = null;
    } else if (heading) {
      const h = document.createElement('h3'); inline(h, heading[1]); target.append(h); list = paragraph = null;
    } else {
      list = null;
      if (!paragraph) { paragraph = document.createElement('p'); target.append(paragraph); }
      else paragraph.append(document.createElement('br'));
      inline(paragraph, line);
    }
  }
}
