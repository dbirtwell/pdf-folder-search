// Pure search helpers (no DOM) so they can be tested outside the browser.

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Builds a regex for the term. Whitespace in the term matches any run of
// whitespace, since PDF text often has irregular spacing and line breaks.
export function buildMatcher(term, { matchCase = false, wholeWord = false } = {}) {
  const words = term.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  let pattern = words.map(escapeRegExp).join('\\s+');
  if (wholeWord) {
    pattern = `(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`;
  }
  return new RegExp(pattern, matchCase ? 'gu' : 'giu');
}

// Joins PDF.js text items into a single string for one page.
export function pageTextFromItems(items) {
  let text = '';
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text.replace(/\s+/g, ' ');
}

// True if the page text contains at least one match.
export function pageContains(text, regex) {
  regex.lastIndex = 0;
  return regex.test(text);
}

// webkitRelativePath is "SelectedFolder/sub/file.pdf"; top-level files have 2 segments.
export function isTopLevel(relativePath) {
  return relativePath.split('/').length <= 2;
}

export function isPdf(name) {
  return /\.pdf$/i.test(name);
}

export function joinPath(base, relative) {
  if (!base) return relative;
  const useBackslash = base.includes('\\') && !base.includes('/');
  const sep = useBackslash ? '\\' : '/';
  const rel = useBackslash ? relative.replace(/\//g, '\\') : relative;
  return base.replace(/[\\/]+$/, '') + sep + rel;
}
