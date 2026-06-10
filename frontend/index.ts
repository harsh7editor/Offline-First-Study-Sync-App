import { registerRootComponent } from 'expo';

import App from './App';

if (typeof window !== 'undefined') {
  const reportError = (payload: any) => {
    fetch('http://localhost:3000/api/debug/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  };

  window.onerror = function (message, source, lineno, colno, error) {
    reportError({
      type: 'onerror',
      message: message ? message.toString() : 'Unknown error',
      source,
      lineno,
      colno,
      stack: error ? error.stack : null,
    });
    return false;
  };

  window.addEventListener('unhandledrejection', function (event) {
    reportError({
      type: 'unhandledrejection',
      message: event.reason ? event.reason.message || event.reason.toString() : 'Unhandled promise rejection',
      stack: event.reason ? event.reason.stack : null,
    });
  });
  console.log('[Debug] Web global error handlers registered');
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
