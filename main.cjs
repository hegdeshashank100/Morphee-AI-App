const { app, BrowserWindow } = require('electron')

function createWindow () {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Morphee AI",
    autoHideMenuBar: true,
    backgroundColor: '#08090c',
    webPreferences: {
      // Enable hardware acceleration
      backgroundThrottling: false,
    }
  })

  // Enable hardware acceleration flags for best GPU performance
  app.commandLine.appendSwitch('enable-gpu-rasterization')
  app.commandLine.appendSwitch('enable-zero-copy')
  app.commandLine.appendSwitch('ignore-gpu-blocklist')

  const path = require('path')
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'))
  } else {
    // Since we are running in dev mode with Vite, load the localhost URL
    win.loadURL('http://localhost:5173')
  }
}

// Force hardware acceleration
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('ignore-gpu-blocklist')

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
