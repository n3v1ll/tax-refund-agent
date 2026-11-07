import { createRoot } from 'react-dom/client';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { App } from './App';
import './styles.css';

GlobalWorkerOptions.workerSrc = workerUrl;
createRoot(document.getElementById('root')!).render(<App />);
