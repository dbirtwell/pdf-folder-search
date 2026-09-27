# PDF Folder Search

Searches every PDF in a folder (and optionally its subfolders) for a word or phrase, lists the files that contain it, and saves the results as a text or PDF report.

It runs two ways from the same code:

- **Desktop app (Electron):** a native app with full file paths, native Open/Save dialogs, and results that open in your default PDF viewer.
- **Web page:** runs in a browser from any web server, or from VS Code Live Server.

Either way, files are read directly from your computer. Nothing is uploaded.

> **Disclaimer: use at your own risk.** This software is provided "as is", without warranty of any kind. It only reads your PDFs and never modifies or deletes them. Even so, you are responsible for checking its results before relying on them. A file may be missed, for example because it is a scanned image with no text, is password-protected, or is damaged. The authors accept no liability for any loss or damage arising from its use. See [License](#license).

## How this was built

This application was created by "vibe coding" with **[Claude Code](https://claude.com/claude-code)**, Anthropic's AI coding assistant, using the **Claude Opus 5.5** model (`claude-opus-5-5`). The requirements were described in plain English, and Claude wrote, tested and revised the code over a series of conversational requests. The code was reviewed and tested with automated browser and Electron tests, but it has not been independently audited. That is part of why it is offered as use-at-your-own-risk software.

## Desktop app

### Run from source

Requires [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm start
```

### Build an installable app

```bash
npm run dist:linux   # dist/PDF Folder Search-1.0.0.AppImage
npm run dist:win     # Windows installer + portable .exe (run this on Windows)
npm run dist:mac     # macOS .dmg (must be run on a Mac)
```

The Linux AppImage is a single file. Make it executable (`chmod +x`) and double-click it. Builds are unsigned, so Windows SmartScreen and macOS Gatekeeper will warn the first time you open the app.

### Desktop features

- Native folder picker. Full file paths appear in the results and reports automatically.
- Click a result to open it in your default PDF viewer, or **Show in folder** to find it in your file manager.
- Reports are saved with a native **Save As** dialog.
- The folder is re-scanned on every search, so newly added files are included.
- Folders that can't be opened (e.g. no permission) are listed in the errors. Symlinked folders are skipped to avoid loops.

## Web version

It must be served over HTTP. Opening `index.html` directly as a `file://` URL won't work, because browsers block JavaScript modules there.

- **VS Code:** right-click `index.html` → **Open with Live Server** (or click **Go Live**).
- **Any web server:** copy `index.html`, `app.js`, `search.js`, `style.css` and `lib/`.
- **Quick local server:** `python3 -m http.server 8000`, then open http://localhost:8000

Browsers don't expose a folder's full path, so fill in "Folder location on disk" to get complete paths in the results and reports.

## Technologies used

| Technology | Version | Used for | License |
|---|---|---|---|
| HTML, CSS, JavaScript (ES modules) | | The user interface and search logic | |
| [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | 4.10.38 | Reading PDFs and extracting their text | Apache-2.0 |
| [jsPDF](https://github.com/parallax/jsPDF) | 2.5.2 | Creating the PDF report | MIT |
| [Electron](https://www.electronjs.org/) | 44.4.5 (Chromium 152, Node.js 24.21) | Desktop app: window, native dialogs, file access | MIT |
| [Node.js](https://nodejs.org/) | 20 or newer | Running and building the desktop app | MIT |
| [electron-builder](https://www.electron.build/) | 26.15.3 | Packaging the desktop app (AppImage, Windows installer, macOS DMG) | MIT |

PDF.js and jsPDF are bundled in `lib/`, so the app works offline. Neither version loads anything from the internet.

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Page layout and styling (shared by both versions) |
| `app.js` | UI, search loop and reports. Uses the Electron bridge in the desktop app and browser APIs otherwise |
| `search.js` | Text matching logic |
| `lib/` | PDF.js 4.10.38 (reads PDFs) and jsPDF 2.5.2 (writes the PDF report) |
| `electron/main.js` | Desktop app: window, folder scanning, file access, dialogs |
| `electron/preload.js` | The limited set of desktop functions the UI is allowed to call |
| `scripts/start.js` | Launches Electron for `npm start` |
| `build/icon.png` | App icon |
| `LICENSE` | MIT license and third-party notices |

## Notes

- **Scanned PDFs** (images of pages with no text layer) can't be searched without OCR.
- **Security:** the desktop UI has no direct Node.js access, and it can only read PDFs inside the folder you chose.
- If `npm start` fails with `Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`, the environment variable `ELECTRON_RUN_AS_NODE` is set (VS Code sets it for some processes). `npm start` clears it automatically. Running `electron .` directly does not.

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 dbirtwell.

In short, you may use, copy, modify, merge, publish, distribute, sublicense and sell copies of this software, provided the copyright notice and permission notice are included in all copies or substantial portions of it. The software is provided **"as is", without warranty of any kind**, and the authors are not liable for any claim, damages or other liability arising from its use. The full text is in [LICENSE](LICENSE).

Third-party components keep their own licenses: PDF.js is under the Apache License 2.0, and jsPDF and Electron are under the MIT License. Details are at the end of [LICENSE](LICENSE).
