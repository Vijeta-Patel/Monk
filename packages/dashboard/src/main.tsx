import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initialTheme, installThemeVars } from './theme.ts';
import './styles.css';

installThemeVars();
document.documentElement.dataset.theme = initialTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
