import React from 'react';
import ReactDOM from 'react-dom/client';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import App from './App';
import './styles.css';

GlobalWorkerOptions.workerSrc = workerUrl;

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
