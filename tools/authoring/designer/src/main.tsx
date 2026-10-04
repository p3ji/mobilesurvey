import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '@mobilesurvey/respondent-view/styles.css';
import './styles.css';
import './theme.css';
import '@mobilesurvey/ui-locale/style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
