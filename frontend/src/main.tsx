import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './app/store';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installChunkRecovery } from './observability/chunkRecovery';
import { initErrorReporting } from './observability/errorReporting';
// Self-hosted variable font: one file covers every weight; only needed scripts are downloaded.
import '@fontsource-variable/inter/wght.css';
import './styles/globals.css';

installChunkRecovery();
void initErrorReporting();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Provider store={store}>
        <App />
      </Provider>
    </ErrorBoundary>
  </React.StrictMode>,
);
