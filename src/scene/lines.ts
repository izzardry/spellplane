/**
 * Connection lines (DESIGN "Combat and annotation"; "Themes and rendering": Paper draws crisp 1.5 px strokes in
 * seat colours). All lines share one fat-line mesh, one draw call; width and colour come from the theme's
 * lineStyle. Endpoints follow the cards' displayed poses.
 */
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { TablePoint } from './types';

export interface LineDraw {
  from: TablePoint;
  to: TablePoint;
  colour: string;
  widthPx: number;
}

const tmp = new THREE.Color();

export class LineLayer {
  readonly object: LineSegments2;
  private material: LineMaterial;
  private geometry: LineSegmentsGeometry;
  private sig = '';

  constructor() {
    this.material = new LineMaterial({ linewidth: 1.5, vertexColors: true, worldUnits: false, transparent: true, depthTest: false, depthWrite: false });
    this.geometry = new LineSegmentsGeometry();
    this.object = new LineSegments2(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 4;
    this.object.visible = false;
    this.object.name = 'lines';
  }

  setResolution(w: number, h: number): void {
    this.material.resolution.set(w, h);
  }

  sync(lines: readonly LineDraw[]): void {
    const sig = lines.map((l) => `${l.from.x.toFixed(2)},${l.from.y.toFixed(2)},${l.to.x.toFixed(2)},${l.to.y.toFixed(2)},${l.colour}`).join(';');
    if (sig === this.sig) return;
    this.sig = sig;
    this.object.visible = lines.length > 0;
    if (!lines.length) return;
    const pos: number[] = [];
    const col: number[] = [];
    for (const l of lines) {
      pos.push(l.from.x, 30, -l.from.y, l.to.x, 30, -l.to.y);
      tmp.set(l.colour);
      col.push(tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b);
    }
    const g = new LineSegmentsGeometry();
    g.setPositions(pos);
    g.setColors(col);
    this.object.geometry.dispose();
    this.object.geometry = g;
    this.geometry = g;
    this.material.linewidth = lines[0]!.widthPx;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
