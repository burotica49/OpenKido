export {};

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      clearGithubSession: () => Promise<void>;
      exportPdf?: () => Promise<{ saved: boolean }>;
    };
  }
}
