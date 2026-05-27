// Custom PDF.js worker entry. PDF.js calls Promise.withResolvers() inside the
// WORKER too — and that API only exists in iOS Safari 17.4+ — so we install the
// polyfills in the worker scope FIRST, then load the legacy PDF.js worker.
// Vite bundles this as a module worker; extract.ts wires it via workerPort.
import '../util/polyfills';
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';
