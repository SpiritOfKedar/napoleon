import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // A short cross-fade between pages where the browser supports view transitions.
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),
    // Not withFetch(): upload progress events need the XHR backend.
    provideHttpClient(),
  ],
};
