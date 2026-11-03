// Production build: the app is served by nginx, which proxies /api to the backend.
export const environment = {
  production: true,
  apiBaseUrl: '/api',
  /** How often the library/upload pages poll while files are still processing. */
  pollIntervalMs: 3000,
};
