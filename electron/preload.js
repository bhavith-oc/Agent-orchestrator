/**
 * Aether Orchestrator — Electron Preload Script
 *
 * Exposes a safe API to the renderer process via contextBridge.
 * The renderer (Aether UI) can call these methods to manage Docker
 * containers and app settings without direct Node.js access.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aether', {
    // Docker management
    docker: {
        start: () => ipcRenderer.invoke('docker:start'),
        stop: () => ipcRenderer.invoke('docker:stop'),
        status: () => ipcRenderer.invoke('docker:status'),
        logs: (service) => ipcRenderer.invoke('docker:logs', service),
        check: () => ipcRenderer.invoke('docker:check'),
    },

    // Settings
    settings: {
        get: (key) => ipcRenderer.invoke('settings:get', key),
        set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    },

    // Shell
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

    // Platform info
    platform: process.platform,
    isElectron: true,
});
