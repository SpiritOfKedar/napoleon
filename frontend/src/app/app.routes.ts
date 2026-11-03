import { Routes } from '@angular/router';

// Each page is a lazily loaded standalone component.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'search' },
  {
    path: 'search',
    title: 'Search · Napoleon',
    loadComponent: () => import('./features/search/search.page').then((m) => m.SearchPage),
  },
  {
    path: 'library',
    title: 'Library · Napoleon',
    loadComponent: () => import('./features/library/library.page').then((m) => m.LibraryPage),
  },
  {
    path: 'upload',
    title: 'Upload · Napoleon',
    loadComponent: () => import('./features/upload/upload.page').then((m) => m.UploadPage),
  },
  {
    path: 'player/:id',
    title: 'Player · Napoleon',
    loadComponent: () => import('./features/player/player.page').then((m) => m.PlayerPage),
  },
  { path: '**', redirectTo: 'search' },
];
