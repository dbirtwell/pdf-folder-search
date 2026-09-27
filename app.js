import * as pdfjsLib from './lib/pdf.min.mjs';
import {
  buildMatcher, pageTextFromItems, pageContains,
  isTopLevel, isPdf, joinPath,
} from './search.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
const el = {
  chooseBtn: $('chooseBtn'),
  folderInput: $('folderInput'),
  folderInfo: $('folderInfo'),
  basePathField: $('basePathField'),
  basePath: $('basePathInput'),
  search: $('searchInput'),
  optSubdirs: $('optSubdirs'),
  optCase: $('optCase'),
  optWhole: $('optWhole'),
  searchBtn: $('searchBtn'),
  cancelBtn: $('cancelBtn'),
  progressWrap: $('progressWrap'),
  progressBar: $('progressBar'),
  progressText: $('progressText'),
  hitCount: $('hitCount'),
  hitList: $('hitList'),
  summary: $('summary'),
  reportStatus: $('reportStatus'),
  txtBtn: $('txtBtn'),
  pdfBtn: $('pdfBtn'),
  errorsWrap: $('errorsWrap'),
  errorCount: $('errorCount'),
  errorList: $('errorList'),
};

// ---------- Platform: desktop (Electron) or browser ----------
//
// A folder is { name, path, entries: [{ relPath, path, ... }], errors: [] }.
// relPath is always "FolderName/sub/file.pdf".

function createDesktopPlatform(api) {
  return {
    isDesktop: true,
    async chooseFolder() {
      const picked = await api.chooseFolder();
      if (!picked) return null;
      el.folderInfo.textContent = `Scanning ${picked.path}…`;
      const folder = { name: picked.name, path: picked.path, entries: [], errors: [] };
      await this.refresh(folder);
      return folder;
    },
    // Re-scans the folder so each search sees files added since it was chosen.
    async refresh(folder) {
      const { files, errors } = await api.listPdfs();
      folder.entries = files;
      folder.errors = errors;
    },
    displayPath: (entry) => entry.path,
    readFile: (entry) => api.readFile(entry.path),
    openFile: (entry) => api.openFile(entry.path),
    showInFolder: (entry) => api.showInFolder(entry.path),
    async saveReport(filename, data, kind) {
      return api.saveReport(filename, data, kind);
    },
  };
}

function createWebPlatform() {
  let pending = null;
  el.folderInput.addEventListener('change', () => {
    pending?.(Array.from(el.folderInput.files));
    pending = null;
  });
  el.folderInput.addEventListener('cancel', () => {
    pending?.(null);
    pending = null;
  });

  return {
    isDesktop: false,
    async chooseFolder() {
      const files = await new Promise((resolve) => {
        pending = resolve;
        el.folderInput.value = '';
        el.folderInput.click();
      });
      if (!files?.length) return null;
      const name = files[0].webkitRelativePath.split('/')[0];
      const entries = files
        .filter((f) => isPdf(f.name))
        .map((f) => ({ relPath: f.webkitRelativePath, file: f }));
      return { name, path: null, entries, errors: [] };
    },
    async refresh() {}, // browsers only give a snapshot of the folder
    displayPath: (entry) => joinPath(el.basePath.value.trim(), entry.relPath),
    readFile: async (entry) => new Uint8Array(await entry.file.arrayBuffer()),
    async openFile(entry, page) {
      const url = URL.createObjectURL(entry.file);
      window.open(`${url}#page=${page}`, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    showInFolder: null,
    async saveReport(filename, data, kind) {
      const type = kind === 'pdf' ? 'application/pdf' : 'text/plain;charset=utf-8';
      download(new Blob([data], { type }), filename);
      return null;
    },
  };
}

const platform = window.pdfSearchDesktop
  ? createDesktopPlatform(window.pdfSearchDesktop)
  : createWebPlatform();

if (platform.isDesktop) {
  el.basePathField.hidden = true;
  document.querySelector('.subtitle').textContent =
    'Search every PDF in a folder for a word or phrase. Files are read directly from your computer.';
}

let folder = null;      // the chosen folder
let cancelled = false;
let lastRun = null;     // results of the most recent search, used for reports

// ---------- Folder selection ----------

el.chooseBtn.addEventListener('click', async () => {
  try {
    const picked = await platform.chooseFolder();
    if (picked) folder = picked;
  } catch (err) {
    el.folderInfo.textContent = `Could not read folder: ${err.message}`;
    return;
  }
  updateFolderInfo();
  updateSearchEnabled();
});

el.optSubdirs.addEventListener('change', updateFolderInfo);
el.search.addEventListener('input', updateSearchEnabled);
el.search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !el.searchBtn.disabled) startSearch();
});

function pdfEntriesToSearch() {
  return folder.entries
    .filter((f) => el.optSubdirs.checked || isTopLevel(f.relPath))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function updateFolderInfo() {
  if (!folder) {
    el.folderInfo.textContent = 'No folder selected';
    return;
  }
  const n = pdfEntriesToSearch().length;
  const scope = el.optSubdirs.checked ? 'including subdirectories' : 'top level only';
  el.folderInfo.textContent = `${folder.path ?? folder.name} — ${n} PDF file${n === 1 ? '' : 's'} (${scope})`;
}

function updateSearchEnabled() {
  el.searchBtn.disabled = !folder || !el.search.value.trim();
}

// ---------- Search ----------

el.searchBtn.addEventListener('click', startSearch);
el.cancelBtn.addEventListener('click', () => { cancelled = true; });

async function startSearch() {
  const term = el.search.value.trim();
  const options = { matchCase: el.optCase.checked, wholeWord: el.optWhole.checked };
  const regex = buildMatcher(term, options);
  if (!regex || !folder) return;

  cancelled = false;
  resetResultsUI();
  setBusy(true);
  el.progressText.textContent = 'Scanning folder…';

  try {
    await platform.refresh(folder);
  } catch (err) {
    el.progressText.textContent = `Could not scan folder: ${err.message}`;
    setBusy(false);
    return;
  }
  updateFolderInfo();
  const entries = pdfEntriesToSearch();

  lastRun = {
    term,
    options: { ...options, subdirs: el.optSubdirs.checked },
    folder: folder.path ?? joinPath(el.basePath.value.trim(), folder.name),
    startedAt: new Date(),
    filesTotal: entries.length,
    filesSearched: 0,
    hits: [],
    errors: [],
    cancelled: false,
  };
  for (const e of folder.errors) addError(e.path, e.message);

  for (let i = 0; i < entries.length; i++) {
    if (cancelled) break;
    const entry = entries[i];
    const path = platform.displayPath(entry);
    el.progressBar.max = entries.length;
    el.progressBar.value = i;
    el.progressText.textContent = `Searching ${i + 1} of ${entries.length}: ${entry.relPath}`;

    try {
      const page = await searchFile(entry, regex);
      if (page === null) break; // cancelled mid-file
      lastRun.filesSearched++;
      if (page > 0) {
        const hit = { path, entry, page };
        lastRun.hits.push(hit);
        addHitToList(hit);
      }
    } catch (err) {
      lastRun.filesSearched++;
      const message = err?.name === 'PasswordException' ? 'Password protected' : (err?.message || String(err));
      addError(path, message);
    }
  }

  lastRun.cancelled = cancelled;
  lastRun.finishedAt = new Date();
  el.progressBar.value = lastRun.filesSearched;
  setBusy(false);
  showSummary();
}

// Returns the first page containing a match, 0 if none, or null if cancelled.
// Stops reading the file at the first match.
async function searchFile(entry, regex) {
  const data = await platform.readFile(entry);
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      if (cancelled) return null;
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      page.cleanup();
      if (pageContains(pageTextFromItems(content.items), regex)) return p;
    }
    return 0;
  } finally {
    doc.destroy();
  }
}

// ---------- Results UI ----------

function resetResultsUI() {
  el.hitList.replaceChildren();
  el.errorList.replaceChildren();
  el.errorsWrap.hidden = true;
  el.errorCount.textContent = '0';
  el.hitCount.textContent = '0';
  el.summary.textContent = '';
  el.reportStatus.hidden = true;
  el.txtBtn.disabled = true;
  el.pdfBtn.disabled = true;
}

function setBusy(busy) {
  el.searchBtn.disabled = busy;
  el.cancelBtn.hidden = !busy;
  el.progressWrap.hidden = false;
  el.chooseBtn.disabled = busy;
  if (!busy) updateSearchEnabled();
}

function actionLink(text, title, onClick) {
  const a = document.createElement('a');
  a.href = '#';
  a.textContent = text;
  a.title = title;
  a.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await onClick();
    } catch (err) {
      alert(err.message);
    }
  });
  return a;
}

function addHitToList(hit) {
  const li = document.createElement('li');

  li.className = 'hit';
  const link = actionLink(hit.path, 'Open this PDF', () => platform.openFile(hit.entry, hit.page));
  link.className = 'hit-path';
  li.append(link);
  if (platform.showInFolder) {
    const show = actionLink('Show in folder', 'Show this file in your file manager', () => platform.showInFolder(hit.entry));
    show.className = 'hit-action';
    li.append(show);
  }

  el.hitList.append(li);
  el.hitCount.textContent = String(lastRun.hits.length);
}

function addError(path, message) {
  lastRun.errors.push({ path, message });
  const li = document.createElement('li');
  li.textContent = `${path} — ${message}`;
  el.errorList.append(li);
  el.errorsWrap.hidden = false;
  el.errorCount.textContent = String(lastRun.errors.length);
}

function showSummary() {
  const r = lastRun;
  const secs = ((r.finishedAt - r.startedAt) / 1000).toFixed(1);
  let text = `Found "${r.term}" in ${r.hits.length} of ${r.filesSearched} PDF file${r.filesSearched === 1 ? '' : 's'} searched (${secs}s).`;
  if (r.cancelled) text += ` Search cancelled — ${r.filesTotal - r.filesSearched} file(s) not searched.`;
  el.summary.textContent = text;
  el.progressText.textContent = r.cancelled ? 'Cancelled.' : 'Done.';
  if (!r.hits.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No matches found.';
    el.hitList.append(li);
  }
  el.txtBtn.disabled = false;
  el.pdfBtn.disabled = false;
}

// ---------- Reports ----------

el.txtBtn.addEventListener('click', () => {
  saveReport(`pdf-search-report-${timestamp()}.txt`, buildReportLines().join('\r\n'), 'txt');
});

el.pdfBtn.addEventListener('click', () => {
  saveReport(`pdf-search-report-${timestamp()}.pdf`, buildPdfReport(), 'pdf');
});

async function saveReport(filename, data, kind) {
  try {
    const savedPath = await platform.saveReport(filename, data, kind);
    if (savedPath) {
      el.reportStatus.textContent = `Report saved to ${savedPath}`;
      el.reportStatus.hidden = false;
    }
  } catch (err) {
    el.reportStatus.textContent = `Could not save report: ${err.message}`;
    el.reportStatus.hidden = false;
  }
}

function buildPdfReport() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 50;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const bottom = doc.internal.pageSize.getHeight() - margin;
  let y = margin;

  const write = (text, { size = 10, bold = false, gap = 4, indent = 0 } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const lineHeight = size * 1.3;
    for (const line of doc.splitTextToSize(toLatin1(text), width - indent)) {
      if (y + lineHeight > bottom) { doc.addPage(); y = margin; }
      doc.text(line, margin + indent, y + size);
      y += lineHeight;
    }
    y += gap;
  };

  const r = lastRun;
  write('PDF Search Report', { size: 18, bold: true, gap: 10 });
  const labelWidth = 90;
  for (const [label, value] of reportHeaderLines()) {
    const rowY = y;
    write(value, { indent: labelWidth });
    const after = y;
    y = rowY;
    write(`${label}:`, { bold: true });
    y = after;
  }
  y += 8;
  write(`Files containing the search term (${r.hits.length})`, { size: 13, bold: true, gap: 6 });
  if (!r.hits.length) write('None.');
  r.hits.forEach((h, i) => {
    write(`${i + 1}. ${h.path}`);
  });
  if (r.errors.length) {
    y += 8;
    write(`Files that could not be read (${r.errors.length})`, { size: 13, bold: true, gap: 6 });
    for (const e of r.errors) write(`${e.path} — ${e.message}`, { size: 9 });
  }

  return new Uint8Array(doc.output('arraybuffer'));
}

function reportHeaderLines() {
  const r = lastRun;
  const opts = [
    r.options.subdirs ? 'include subdirectories' : 'top-level folder only',
    r.options.matchCase ? 'match case' : 'ignore case',
    r.options.wholeWord ? 'whole word/phrase' : 'partial matches allowed',
  ].join(', ');
  const rows = [
    ['Search term', `"${r.term}"`],
    ['Folder', r.folder],
    ['Options', opts],
    ['Date', r.startedAt.toLocaleString()],
    ['Files searched', `${r.filesSearched} of ${r.filesTotal}`],
    ['Files matched', String(r.hits.length)],
  ];
  if (r.cancelled) rows.push(['Note', 'search was cancelled before finishing']);
  return rows;
}

function buildReportLines() {
  const r = lastRun;
  const header = reportHeaderLines().map(([label, value]) => `${(label + ':').padEnd(17)}${value}`);
  const lines = ['PDF SEARCH REPORT', '='.repeat(60), ...header, ''];
  lines.push(`FILES CONTAINING THE SEARCH TERM (${r.hits.length})`, '-'.repeat(60));
  if (!r.hits.length) lines.push('None.');
  r.hits.forEach((h, i) => {
    lines.push(`${i + 1}. ${h.path}`);
  });
  if (r.errors.length) {
    lines.push('', `FILES THAT COULD NOT BE READ (${r.errors.length})`, '-'.repeat(60));
    for (const e of r.errors) lines.push(`${e.path} — ${e.message}`);
  }
  return lines;
}

// jsPDF's built-in fonts only cover Latin-1; replace other characters.
function toLatin1(s) {
  return s.replace(/[—–]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...')
    .replace(/[^\x00-\xFF]/g, '?');
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
