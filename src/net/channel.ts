// A two-way message pipe between host and guest. Online play uses a PeerJS
// data connection (see peer.ts); tests use the in-memory loopback below.

export interface Channel<In, Out> {
  send(m: Out): void;
  onMessage: ((m: In) => void) | null;
  /** The other side went away (it may come back: see reconnect handling). */
  onClose: (() => void) | null;
  close(): void;
}

/**
 * Two connected in-memory channels. Messages are queued, not delivered at once,
 * so a test controls exactly when each side hears the other (call flush()).
 * They go through JSON, like the real thing, so anything unserializable shows up.
 */
export function loopback<A, B>(): { a: Channel<B, A>; b: Channel<A, B>; flush: () => number } {
  const toA: string[] = [];
  const toB: string[] = [];
  const a: Channel<B, A> = { send: (m) => toB.push(JSON.stringify(m)), onMessage: null, onClose: null, close: () => b.onClose?.() };
  const b: Channel<A, B> = { send: (m) => toA.push(JSON.stringify(m)), onMessage: null, onClose: null, close: () => a.onClose?.() };
  const flush = () => {
    let n = 0;
    while (toA.length || toB.length) {
      while (toB.length) {
        b.onMessage?.(JSON.parse(toB.shift()!));
        n++;
      }
      while (toA.length) {
        a.onMessage?.(JSON.parse(toA.shift()!));
        n++;
      }
    }
    return n;
  };
  return { a, b, flush };
}
