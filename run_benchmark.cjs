const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

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

  const targetUrl = 'http://localhost:5173/test_perf_benchmark.html';
  console.log(`[Benchmark Runner] Loading ${targetUrl}...`);

  win.webContents.on('console-message', (event, level, message) => {
    console.log(`[Browser Console] ${message}`);
  });

  win.loadURL(targetUrl);

  const checkInterval = setInterval(async () => {
    try {
      const results = await win.webContents.executeJavaScript('window.__benchmarkResults || null');
      if (results) {
        clearInterval(checkInterval);
        console.log('[Benchmark Runner] Benchmark completed successfully!');
        const outPath = path.resolve(__dirname, 'benchmark_results.json');
        fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
        console.log(`[Benchmark Runner] Wrote results to ${outPath}`);
        console.log(JSON.stringify(results, null, 2));
        app.exit(0);
      }
    } catch (err) {
      // Still loading or initializing
    }
  }, 1000);

  setTimeout(() => {
    console.error('[Benchmark Runner] Benchmark timed out after 120 seconds.');
    app.exit(1);
  }, 120000);
});
