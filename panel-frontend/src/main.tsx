import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import App from './App';

// Импортируем стили Gravity UI
import '@gravity-ui/uikit/styles/fonts.css';
import '@gravity-ui/uikit/styles/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider theme="light">
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
