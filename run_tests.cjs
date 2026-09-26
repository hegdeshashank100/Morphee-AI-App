const { app, BrowserWindow } = require('electron');
const path = require('path');

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

  const targetUrl = 'http://localhost:5173/test_phase12_complete.html';
  console.log(`[Test Suite Runner] Loading ${targetUrl}...`);
  win.loadURL(targetUrl);

  const checkInterval = setInterval(async () => {
    try {
      const summary = await win.webContents.executeJavaScript(`
        (() => {
          const passBadges = document.querySelectorAll('.badge-pass').length;
          const failBadges = document.querySelectorAll('.badge-fail').length;
          const totalRows = document.querySelectorAll('.test-table tr').length - document.querySelectorAll('.test-table th').length;
          const statusPill = document.getElementById('statusPill');
          const statusText = statusPill ? statusPill.textContent : '';
          return { passBadges, failBadges, totalRows, statusText };
        })()
      `);
      if (summary && summary.passBadges >= 38) {
        clearInterval(checkInterval);
        console.log(`[Test Suite Runner] COMPLETE: ${summary.passBadges} PASSED, ${summary.failBadges} FAILED! Status: ${summary.statusText}`);
        app.exit(0);
      } else if (summary && summary.failBadges > 0 && (summary.passBadges + summary.failBadges >= 38)) {
        clearInterval(checkInterval);
        console.error(`[Test Suite Runner] FAILED: ${summary.passBadges} PASSED, ${summary.failBadges} FAILED!`);
        app.exit(1);
      }
    } catch (err) {
      // Still running
    }
  }, 1000);

  setTimeout(() => {
    console.error('[Test Suite Runner] Timed out after 60 seconds.');
    app.exit(1);
  }, 60000);
});
