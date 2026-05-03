import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';

import { ClassroomPathApp } from './ClassroomPathApp';
import './openpath/openpath.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing root element for ClassroomPath React app');
}

const app = (
  <React.StrictMode>
    <ClassroomPathApp />
  </React.StrictMode>
);

if (rootElement.hasChildNodes() && rootElement.dataset.classroompathPublicSsr !== 'true') {
  hydrateRoot(rootElement, app);
} else {
  createRoot(rootElement).render(app);
}
