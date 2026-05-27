// Runtime polyfills for older mobile browsers (iOS Safari is the app's main
// phone browser). Import this BEFORE PDF.js.
//
// PRIMARY iOS fix: we pin pdfjs-dist to 4.4.168 — the last release BEFORE the
// 4.5 cutover that started calling `Promise.withResolvers()` (and assuming a
// newer Safari baseline generally). pdf.js >= 4.5 / 5.x threw "undefined is not
// a function" on the cousins' iPhones; v4.4 targets the broad older-Safari
// baseline they run. See package.json + src/lib/pdf/extract.ts.
//
// This shim is now DEFENSIVE depth only: v4.4 doesn't need it, but it's a cheap
// guard for any browser that still lacks `Promise.withResolvers` (Safari < 17.4).

interface Resolvers<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

const PromiseCtor = Promise as unknown as {
  withResolvers?: <T>() => Resolvers<T>;
};

if (typeof PromiseCtor.withResolvers !== 'function') {
  PromiseCtor.withResolvers = function withResolvers<T>(): Resolvers<T> {
    let resolve!: Resolvers<T>['resolve'];
    let reject!: Resolvers<T>['reject'];
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
