import { useSyncExternalStore } from 'react';
import { getState, subscribe } from './store.js';

// Tüm adacıklar tek depodan okur — prop drilling yok, global durum tek yerde.
export function useStore() {
  return useSyncExternalStore(subscribe, getState);
}
