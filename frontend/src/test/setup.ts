import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver; provide a no-op so components that observe layout render.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}
