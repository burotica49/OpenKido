// Preload minimal — the app runs entirely as a web app in the renderer.
// No Node APIs exposed intentionally (contextIsolation: true).
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
});
