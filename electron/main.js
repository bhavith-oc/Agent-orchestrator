/**
 * Aether Orchestrator — Electron Main Process
 *
 * Responsibilities:
 * 1. Start/stop Docker containers (OpenClaw Gateway + Aether API)
 * 2. Load the Aether UI in a BrowserWindow
 * 3. Handle IPC for Docker management from the renderer
 * 4. Manage app lifecycle and auto-updates
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const DockerManager = require('./docker-manager');
const Store = require('electron-store');

const store = new Store({
    defaults: {
        gatewayToken: '',
        openrouterKey: '',
        aetherPort: 8080,
        gatewayPort: 18789,
        autoStartDocker: true,
        windowBounds: { width: 1400, height: 900 },
    },
});

let mainWindow = null;
let dockerManager = null;

// ── Create Main Window ─────────────────────────────────────
function createWindow() {
    const { width, height } = store.get('windowBounds');

    mainWindow = new BrowserWindow({
        width,
        height,
        minWidth: 1024,
        minHeight: 700,
        title: 'Aether Orchestrator',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        backgroundColor: '#0a0a0f',
        titleBarStyle: 'hiddenInset',
        show: false,
    });

    // Save window size on resize
    mainWindow.on('resize', () => {
        const [w, h] = mainWindow.getSize();
        store.set('windowBounds', { width: w, height: h });
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Load the Aether UI
    const aetherPort = store.get('aetherPort');
    mainWindow.loadURL(`http://localhost:${aetherPort}`).catch(() => {
        // If API isn't ready yet, show a loading page
        mainWindow.loadFile(path.join(__dirname, 'assets', 'loading.html'));
        // Retry after a delay
        setTimeout(() => {
            mainWindow.loadURL(`http://localhost:${aetherPort}`).catch(() => {
                dialog.showErrorBox(
                    'Connection Error',
                    `Could not connect to Aether API on port ${aetherPort}.\n\nMake sure Docker is running and the containers are started.`
                );
            });
        }, 5000);
    });
}

// ── Docker Management IPC ──────────────────────────────────
function setupIPC() {
    dockerManager = new DockerManager({
        composeFile: path.join(app.getPath('userData'), 'docker-compose.yml'),
        envFile: path.join(app.getPath('userData'), '.env'),
    });

    // Start all containers
    ipcMain.handle('docker:start', async () => {
        try {
            await dockerManager.startAll();
            return { ok: true, message: 'Containers started' };
        } catch (e) {
            return { ok: false, message: e.message };
        }
    });

    // Stop all containers
    ipcMain.handle('docker:stop', async () => {
        try {
            await dockerManager.stopAll();
            return { ok: true, message: 'Containers stopped' };
        } catch (e) {
            return { ok: false, message: e.message };
        }
    });

    // Get container status
    ipcMain.handle('docker:status', async () => {
        try {
            return await dockerManager.getStatus();
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    // Get container logs
    ipcMain.handle('docker:logs', async (_, service) => {
        try {
            return await dockerManager.getLogs(service);
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    // Check if Docker is available
    ipcMain.handle('docker:check', async () => {
        try {
            return await dockerManager.checkDocker();
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    // Get/set settings
    ipcMain.handle('settings:get', (_, key) => store.get(key));
    ipcMain.handle('settings:set', (_, key, value) => {
        store.set(key, value);
        return true;
    });

    // Open external URLs
    ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));
}

// ── App Lifecycle ──────────────────────────────────────────
app.whenReady().then(async () => {
    setupIPC();

    // Copy compose files to userData on first run
    await dockerManager.ensureComposeFiles();

    // Auto-start Docker containers if enabled
    if (store.get('autoStartDocker')) {
        try {
            const dockerOk = await dockerManager.checkDocker();
            if (dockerOk.ok) {
                await dockerManager.startAll();
            }
        } catch (e) {
            console.error('Auto-start failed:', e.message);
        }
    }

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
    // Optionally stop containers on quit
    // await dockerManager.stopAll();
});
