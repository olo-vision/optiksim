// zuerst: Rücksprung aus Auth-Links (E-Mail-Änderung) festhalten, bevor supabase-js die Adresse auswertet
import './cloud/emailChange';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './app/router';
import './styles/tokens.css';
import './styles/app.css';
import './styles/platform.css';
import './styles/workbench.css';
import './styles/modules.css';
import './styles/saas.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
