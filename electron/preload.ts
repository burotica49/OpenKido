// Preload minimal : l'app tourne comme une application web dans le renderer.
// L'API n'est exposée qu'aux pages de l'application (localhost), jamais aux pages github.com
// affichées dans la même fenêtre pendant la connexion OAuth.
import { contextBridge, ipcRenderer } from "electron";

const host = globalThis.location?.hostname;
if (host === "localhost" || host === "127.0.0.1") {
  contextBridge.exposeInMainWorld("electronAPI", {
    platform: process.platform,
    clearGithubSession: () => ipcRenderer.invoke("clear-github-session"),
    exportPdf: () => ipcRenderer.invoke("export-pdf"),
  });
}
