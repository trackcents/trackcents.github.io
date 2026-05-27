// Runtime polyfills for older mobile browsers (iOS Safari is the app's main
// phone browser). Import this BEFORE PDF.js.
//
// PDF.js 5.x calls `Promise.withResolvers()` heavily — an API that only landed
// in iOS Safari 17.4. On an iPhone running iOS 17.0–17.3, importing a PDF threw
// "undefined is not a function". This shim makes it work on those devices.

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
