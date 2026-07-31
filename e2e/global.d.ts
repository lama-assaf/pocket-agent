// e2e/global.d.ts
// Minimal ambient typing for the renderer's window.pocketAgent contract
// (src/main/preload.ts) inside page.evaluate() callbacks. Loose on purpose —
// the real, exhaustive contract lives in preload.ts; this only exists so
// e2e spec files don't need `as any` casts for every IPC call. Not part of
// any tsconfig `include` (e2e/ is intentionally outside src/ and tests/),
// so this has zero effect on `npm run typecheck` or the unit suite.
export {};

declare global {
  interface Window {
    pocketAgent: {
      settings: {
        isFirstRun(): Promise<boolean>;
        set(key: string, value: string): Promise<void>;
        get(key: string): Promise<string | null>;
      };
      clients: {
        list(): Promise<Array<{ id: string; name: string; sync_mode: string; repo_url: string | null }>>;
      };
      projects: {
        list(clientId: string): Promise<Array<{ id: string; clientId: string; name: string }>>;
      };
      facts: {
        list(
          scope?: string
        ): Promise<Array<{ id: number; category: string; subject: string; content: string; scope: string }>>;
      };
      analytics: {
        list(
          context: { contextType: string; clientId: string | null; projectKey: string | null },
          channel?: string
        ): Promise<
          Array<{
            id: number;
            channel: string;
            external_ref: string;
            title: string | null;
            impressions: number;
            likes: number;
            comments: number;
            shares: number;
            source: string;
            media_urls: string[];
            top_comments: string | null;
          }>
        >;
        record(
          input: {
            channel: string;
            externalRef: string;
            title?: string;
            impressions?: number;
            likes?: number;
            comments?: number;
            shares?: number;
            clicks?: number;
            videoViews?: number;
            source?: 'manual' | 'mcp';
            mediaUrls?: string[] | null;
            topComments?: Array<{ author: string; text: string; likes: number }> | null;
          },
          context: { contextType: string; clientId: string | null; projectKey: string | null }
        ): Promise<{ success: boolean; error?: string }>;
      };
      mcp: {
        listServers(context?: {
          contextType: string;
          clientId: string | null;
          projectKey: string | null;
        }): Promise<Array<{ id: string; name: string; enabled: boolean; toggleable: boolean }>>;
      };
    };
  }
}
