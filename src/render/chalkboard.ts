// A chalkboard scoreboard nailed to a post at each end. Tally marks go up in
// fives as points come in; the marks from an inning with a live ringer get a
// chalk underline. New marks are drawn in stroke by stroke.

import * as THREE from 'three';
import '@fontsource/caveat/600.css';
import type { Stake } from '../rules';
import type { Materials } from './materials';
import { tiledClone } from './materials';

const W = 1024;
const H = 640;
const BOARD_W = 0.9;
const BOARD_H = (BOARD_W * H) / W;

export interface BoardRow {
  name: string;
  color: string;
  /** Points scored in each inning so far. */
  innings: { points: number; ringer: boolean }[];
}

export interface BoardState {
  title: string;
  footer: string;
  rows: BoardRow[];
}

/** Where a board stands for a given end: beside the pit, behind the stake, facing the pitcher. */
export function boardPlacement(stake: Stake) {
  const back = stake.leanDir.z;
  return {
    position: new THREE.Vector3(stake.base.x + 1.55, 1.2, stake.base.z - back * 1.0),
    facing: back, // +1 faces +z
  };
}

export class Chalkboard {
  readonly group = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private state: BoardState = { title: '', footer: '', rows: [] };
  /** How many inning chunks per row are fully drawn; the next is animating. */
  private drawn: number[] = [];
  private anim = 1;
  private grain: HTMLCanvasElement;

  constructor(stake: Stake, mats: Materials) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.grain = makeGrain();

    const slate = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H), new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.95 }));
    slate.position.z = 0.026;
    const frameMat = tiledClone(mats.wood, 0.4, 0.2);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 0.08, BOARD_H + 0.08, 0.05), frameMat);
    frame.castShadow = true;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.2 + BOARD_H / 2, 0.09), mats.darkWood);
    post.position.set(0, -(1.2 + BOARD_H / 2) / 2 + BOARD_H / 2 - 0.02, -0.07);
    post.castShadow = true;
    this.group.add(frame, slate, post);
    const { position, facing } = boardPlacement(stake);
    this.group.position.copy(position);
    // Face the pitcher at the far end, angled a little toward the court's center.
    this.group.rotation.y = facing > 0 ? -0.35 : Math.PI + 0.35;
    this.redraw();
    document.fonts?.load('600 60px Caveat').then(() => this.redraw());
  }

  /** Show a new state. Chunks that weren't on the board before are chalked in. */
  set(state: BoardState, animate: boolean) {
    const sameRows = state.rows.length === this.state.rows.length && state.rows.every((r, i) => r.name === this.state.rows[i]?.name);
    this.drawn = state.rows.map((r, i) => (sameRows && animate ? Math.min(this.drawn[i] ?? 0, r.innings.length) : r.innings.length));
    this.state = state;
    this.anim = animate ? 0 : 1;
    this.redraw();
  }

  update(dt: number) {
    if (this.anim >= 1) return;
    this.anim = Math.min(1, this.anim + dt / 1.2);
    this.redraw();
    if (this.anim >= 1) this.drawn = this.state.rows.map((r) => r.innings.length);
  }

  private redraw() {
    const c = this.ctx;
    // Slate with old erased smudges.
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = '#25302b';
    c.fillRect(0, 0, W, H);
    c.globalAlpha = 0.05;
    c.drawImage(this.grain, 0, 0, W, H);
    c.globalAlpha = 1;

    c.font = '600 54px Caveat, "Comic Sans MS", cursive';
    c.textBaseline = 'alphabetic';
    c.fillStyle = 'rgba(240, 236, 226, 0.92)';
    c.fillText(this.state.title, 40, 70);
    c.font = '600 36px Caveat, "Comic Sans MS", cursive';
    c.fillStyle = 'rgba(240, 236, 226, 0.7)';
    c.fillText(this.state.footer, 40, H - 32);

    this.state.rows.forEach((row, r) => this.drawRow(row, r));
    // Chalk is never solid: knock specks out of everything drawn.
    c.globalCompositeOperation = 'destination-out';
    c.globalAlpha = 0.15;
    c.drawImage(this.grain, 0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    this.tex.needsUpdate = true;
  }

  private drawRow(row: BoardRow, r: number) {
    const c = this.ctx;
    const y = 160 + r * 210;
    const total = row.innings.reduce((s, i) => s + i.points, 0);

    c.font = '600 58px Caveat, "Comic Sans MS", cursive';
    c.fillStyle = 'rgba(244, 240, 230, 0.95)';
    c.fillText(row.name, 40, y);
    c.fillStyle = row.color;
    c.fillRect(40, y + 10, Math.min(200, c.measureText(row.name).width), 5);
    c.font = '600 84px Caveat, "Comic Sans MS", cursive';
    c.fillStyle = 'rgba(244, 240, 230, 0.95)';
    c.textAlign = 'right';
    c.fillText(String(this.visibleTotal(row, r, total)), W - 40, y + 10);
    c.textAlign = 'left';

    // Tally marks, in groups of five, two rows of up to 6 groups.
    let mark = 0;
    const done = this.drawn[r] ?? row.innings.length;
    row.innings.forEach((inn, k) => {
      if (k > done) return;
      const progress = k < done ? 1 : this.anim;
      const first = mark;
      const shown = Math.floor(inn.points * progress + 1e-6);
      for (let m = 0; m < shown; m++) this.tally(first + m, y);
      mark += inn.points;
      if (inn.ringer && progress >= 1 && inn.points > 0) this.underline(first, first + inn.points - 1, y);
    });
  }

  private visibleTotal(row: BoardRow, r: number, total: number) {
    const done = this.drawn[r] ?? row.innings.length;
    if (this.anim >= 1 || done >= row.innings.length) return total;
    return row.innings.slice(0, done).reduce((s, i) => s + i.points, 0);
  }

  /** Where tally mark n goes: 5 per group, 6 groups per line. */
  private markPos(n: number, y: number) {
    const group = Math.floor(n / 5);
    const line = Math.floor(group / 6);
    const gx = 300 + (group % 6) * 108;
    return { group, i: n % 5, x: gx, y: y - 52 + line * 82 };
  }

  private tally(n: number, y: number) {
    const c = this.ctx;
    const p = this.markPos(n, y);
    const j = (s: number) => Math.sin(n * 12.9898 + s * 78.233) * 4; // steady per-mark wobble
    c.strokeStyle = 'rgba(242, 238, 228, 0.9)';
    c.lineWidth = 6;
    c.lineCap = 'round';
    c.beginPath();
    if (p.i < 4) {
      const x = p.x + p.i * 18;
      c.moveTo(x + j(1), p.y + j(2));
      c.lineTo(x + j(3), p.y + 58 + j(4));
    } else {
      c.moveTo(p.x - 10 + j(1), p.y + 48 + j(2));
      c.lineTo(p.x + 66 + j(3), p.y + 8 + j(4));
    }
    c.stroke();
  }

  private underline(from: number, to: number, y: number) {
    const a = this.markPos(from, y);
    const b = this.markPos(to, y);
    const c = this.ctx;
    c.strokeStyle = 'rgba(255, 214, 120, 0.9)';
    c.lineWidth = 5;
    c.beginPath();
    if (a.y === b.y) {
      c.moveTo(a.x - 8, a.y + 72);
      c.quadraticCurveTo((a.x + b.x) / 2 + 30, a.y + 80, b.x + 70, a.y + 70);
    }
    c.stroke();
  }
}

/** A mottled texture used for slate smudges and chalk breakup. */
function makeGrain(): HTMLCanvasElement {
  const g = document.createElement('canvas');
  g.width = 256;
  g.height = 160;
  const c = g.getContext('2d')!;
  const img = c.createImageData(256, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() < 0.18 ? 255 : 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = v;
  }
  c.putImageData(img, 0, 0);
  return g;
}
