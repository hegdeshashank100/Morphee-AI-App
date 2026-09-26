const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('force_high_performance_gpu');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const targetUrl = 'http://localhost:5173/test_multiperson_verification.html';
  console.log(`[MP Test Runner] Loading ${targetUrl}...`);
  win.loadURL(targetUrl);

  const checkInterval = setInterval(async () => {
    try {
      const summary = await win.webContents.executeJavaScript(`
        (() => {
          return window.__testSummary || null;
        })()
      `);

      if (summary && summary.done) {
        clearInterval(checkInterval);
        console.log(`\n======================================================`);
        console.log(`MULTI-PERSON VERIFICATION SUITE RESULTS:`);
        console.log(`======================================================`);
        for (const res of summary.results) {
          const statusStr = res.pass ? 'PASS' : 'FAIL';
          console.log(`[${statusStr}] ${res.id}: ${res.observed}`);
        }
        console.log(`======================================================`);
        console.log(`TOTAL: ${summary.passed} / ${summary.total} PASSED (${summary.failed} FAILED)`);
        console.log(`======================================================\n`);

        if (summary.failed === 0 && summary.passed === 20) {
          app.exit(0);
        } else {
          app.exit(1);
        }
      }
    } catch (err) {
      // Still loading
    }
  }, 500);

  setTimeout(() => {
    console.error('[MP Test Runner] Timed out after 40 seconds.');
    app.exit(1);
  }, 40000);
});
