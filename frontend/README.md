# Napoleon frontend

Angular 21 (standalone components, Angular Material, signals + RxJS). See the root README for the full stack.

```bash
npm install
npx ng serve                   # http://localhost:4200, talks to http://localhost:8080/api
npx ng test --watch=false      # Vitest unit tests
npx ng build                   # production build (served by nginx in Docker, /api proxied to the backend)
```

- `src/app/core`: `ApiService`, DTO interfaces, timestamp formatter, highlighter
- `src/app/features/*`: lazy-loaded pages (search, library, upload, player)
- `src/environments`: API base URL and poll interval
