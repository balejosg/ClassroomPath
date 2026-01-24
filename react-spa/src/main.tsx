import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClassroomPathApp } from './ClassroomPathApp';
import '@openpath/src/index.css'; // Estilos de OpenPath

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClassroomPathApp />
  </React.StrictMode>
);
