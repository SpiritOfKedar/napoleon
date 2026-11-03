// `ng serve`: talk to the backend directly (it allows http://localhost:4200 via CORS_ALLOWED_ORIGINS).
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:8080/api',
  pollIntervalMs: 3000,
};
