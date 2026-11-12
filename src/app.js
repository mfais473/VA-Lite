import { initChat } from './ui/chat.js';

let started = false;

export function startApp() {
  if (started) {
    console.warn('⚠️ startApp() dipanggil ulang — diabaikan.');
    return;
  }
  started = true;
  initChat();
}
