// PeerJS transport: rooms with short codes, and a Channel over a WebRTC data
// connection. PeerJS's free public broker introduces the two browsers; after
// that they talk directly. No game server.
//
// For tests (or a homelab broker), point at another PeerServer with URL
// parameters: ?peerhost=localhost&peerport=9000&peerpath=/&peersecure=0

import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { Channel } from './channel';
import type { GuestMessage, HostMessage } from './protocol';

/** Namespaces our room ids on the shared public broker. */
const PREFIX = 'dusk-at-the-pits-v1-';
/** No 0/O, 1/I/L: codes get read out loud and typed on phones. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newRoomCode(length = 5): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Broker settings: the public PeerJS broker unless the URL says otherwise. */
function brokerOptions(): Partial<PeerOptions> {
  const q = new URLSearchParams(location.search);
  const host = q.get('peerhost');
  if (!host) return { debug: 0 };
  return {
    host,
    port: Number(q.get('peerport') ?? 443),
    path: q.get('peerpath') ?? '/',
    secure: q.get('peersecure') !== '0',
    debug: 0,
  };
}

/** The share link for a room, keeping any broker override so tests and homelab setups work. */
export function roomLink(code: string): string {
  const q = new URLSearchParams(location.search);
  for (const k of [...q.keys()]) if (!k.startsWith('peer')) q.delete(k);
  q.set('join', code);
  return `${location.origin}${location.pathname}?${q.toString()}`;
}

class PeerChannel<In, Out> implements Channel<In, Out> {
  onMessage: ((m: In) => void) | null = null;
  onClose: (() => void) | null = null;
  private closed = false;

  constructor(private readonly conn: DataConnection) {
    conn.on('data', (d) => this.onMessage?.(d as In));
    const lost = () => {
      if (this.closed) return;
      this.closed = true;
      this.onClose?.();
    };
    conn.on('close', lost);
    conn.on('error', lost);
    conn.peerConnection?.addEventListener('connectionstatechange', () => {
      const s = conn.peerConnection?.connectionState;
      if (s === 'failed' || s === 'disconnected' || s === 'closed') lost();
    });
  }

  send(m: Out) {
    if (this.conn.open) this.conn.send(m);
  }

  close() {
    this.closed = true;
    this.conn.close();
  }
}

function waitOpen(peer: Peer, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
    peer.once('open', () => (window.clearTimeout(t), resolve()));
    peer.once('error', (e) => (window.clearTimeout(t), reject(e)));
  });
}

export type GuestArrival = (channel: Channel<GuestMessage, HostMessage>, hello: Extract<GuestMessage, { t: 'hello' }>) => void;

/** The host's open room: waits for guests and hands each over once they say hello. */
export class RoomHost {
  onGuest: GuestArrival | null = null;

  private constructor(
    readonly code: string,
    private readonly peer: Peer,
  ) {
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        const ch = new PeerChannel<GuestMessage, HostMessage>(conn);
        ch.onMessage = (m) => {
          if (m.t !== 'hello') return;
          ch.onMessage = null;
          this.onGuest?.(ch, m);
        };
      });
    });
    // Lost the broker (not the guest): try to get back so a dropped guest can find us again.
    peer.on('disconnected', () => {
      if (!peer.destroyed) window.setTimeout(() => peer.reconnect(), 1500);
    });
  }

  static async open(): Promise<RoomHost> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = newRoomCode();
      const peer = new Peer(PREFIX + code, brokerOptions() as PeerOptions);
      try {
        await waitOpen(peer, 15000);
        return new RoomHost(code, peer);
      } catch (e) {
        peer.destroy();
        if ((e as { type?: string }).type !== 'unavailable-id') throw e;
      }
    }
    throw new Error('Could not get a room code. Try again in a moment.');
  }

  get link(): string {
    return roomLink(this.code);
  }

  close() {
    this.peer.destroy();
  }
}

/** Join a host's room. Resolves once the data connection is open. */
export async function joinRoom(code: string, timeoutMs = 20000): Promise<{ channel: Channel<HostMessage, GuestMessage>; leave: () => void }> {
  const peer = new Peer(brokerOptions() as PeerOptions);
  try {
    await waitOpen(peer, timeoutMs);
    const conn = peer.connect(PREFIX + normalizeCode(code), { reliable: true, serialization: 'json' });
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
      conn.once('open', () => (window.clearTimeout(t), resolve()));
      conn.once('error', (e) => (window.clearTimeout(t), reject(e)));
      peer.once('error', (e) => (window.clearTimeout(t), reject(e)));
    });
    return { channel: new PeerChannel<HostMessage, GuestMessage>(conn), leave: () => peer.destroy() };
  } catch (e) {
    peer.destroy();
    const type = (e as { type?: string }).type;
    if (type === 'peer-unavailable') throw new Error('No game with that code. Check it with your friend; rooms close when the host leaves.');
    if ((e as Error).message === 'timeout') throw new Error('Couldn’t reach your friend. Check your connection and try again.');
    throw new Error('Couldn’t connect. Try again in a moment.');
  }
}
