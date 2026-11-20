/**
 * Pile and zone marks of the M7 table worlds (PLAN M7-P1 Table worlds: "pile and zone marks (library, graveyard,
 * exile, command) in the look's style, seat colours with shapes"; docs/design/m7-hud-proposal.md, Piles on the table:
 * "Empty hairline boxes make the table look like a wireframe"). Drawn by the theme from the table's zones
 * (themes/types.ts TableMarks) under the scene's own hairlines and labels:
 *
 * - a bed under each pile slot (a printed patch on the playmat, a recessed slot in slate, a darker tooled panel);
 * - a bed under each command area, quieter than the piles;
 * - optionally a raised panel per territory (Graphite's layered surfaces);
 * - a plaque at each named chair's avatar spot, set into the frame and level with the table, so the scene's name label
 *   reads on it, with the seat's glyph in its seat colour (themes/types.ts SeatColour: the same shape in every look).
 *
 * Three draws at most for beds, panels and plaques plus one for the glyphs, whatever the number of seats.
 */
import * as THREE from 'three';
import { CARD_H, CARD_W, rot2 } from '../../scene/math';
import type { MaterialSpec, SeatColour, TableMarks } from '../types';
import { type Parts, flatGeometry, glyphGeometry, lineGeometry, loopSegments, merge, roundedRect, roundedRectPoints, slabGeometry } from './world';

/** How a look marks its zones. */
export interface MarkStyle {
  /** Height of the table top (where the beds lie), mm. */
  top: number;
  /** Pile beds: the slot grown by `padMm` on every side, corner radius. */
  bed: { spec: MaterialSpec; padMm: number; radiusMm: number } | null;
  /** Command areas. */
  area: { spec: MaterialSpec; radiusMm: number } | null;
  /** A panel over each territory in use. */
  territory: { spec: MaterialSpec; radiusMm: number; insetMm: number } | null;
  /** Plaques at named chairs: a pill `lengthMm` × `heightMm` along the seat's edge, from `baseMm` (the frame's top) up to `top`; an optional outline colour. */
  plaque: { spec: MaterialSpec; lengthMm: number; heightMm: number; baseMm: number; outline: string | null } | null;
  /** The seat glyph on the plaque: size, and its offset from the plaque's centre along the seat's edge. */
  glyph: { sizeMm: number; offsetMm: number };
}

/** What the marks layer drew last (tests and the debug view). */
export interface MarksDrawn {
  beds: number;
  areas: number;
  territories: number;
  plaques: number;
  glyphs: { seat: number; glyph: string; colour: string; x: number; y: number }[];
}

/** The marks of one built theme: redrawn whenever the table's zones change. */
export class MarksLayer {
  readonly object = new THREE.Group();
  private geos: THREE.BufferGeometry[] = [];
  private readonly mats: { bed?: THREE.Material; area?: THREE.Material; territory?: THREE.Material; plaque?: THREE.Material; glyph: THREE.Material; outline?: THREE.LineBasicMaterial };
  drawn: MarksDrawn = { beds: 0, areas: 0, territories: 0, plaques: 0, glyphs: [] };

  constructor(
    private parts: Parts,
    private style: MarkStyle,
    private seats: readonly SeatColour[],
    private name: string,
  ) {
    this.object.name = `${name}-marks`;
    this.mats = {
      ...(style.bed ? { bed: parts.overlay(style.bed.spec, 2) } : {}),
      ...(style.area ? { area: parts.overlay(style.area.spec, 2) } : {}),
      ...(style.territory ? { territory: parts.overlay(style.territory.spec, 1) } : {}),
      ...(style.plaque ? { plaque: parts.material(style.plaque.spec) } : {}),
      ...(style.plaque?.outline ? { outline: parts.own(new THREE.LineBasicMaterial({ color: style.plaque.outline, toneMapped: false })) } : {}),
      glyph: parts.own(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -12, depthWrite: false })),
    };
  }

  private add(geo: THREE.BufferGeometry | null, material: THREE.Material | undefined, name: string, order: number, lines = false): void {
    if (!geo || !material) {
      geo?.dispose();
      return;
    }
    this.parts.geometry(geo);
    this.geos.push(geo);
    const o = lines ? new THREE.LineSegments(geo, material) : new THREE.Mesh(geo, material);
    o.name = name;
    o.renderOrder = order;
    if (!lines) (o as THREE.Mesh).receiveShadow = true;
    this.object.add(o);
  }

  private clear(): void {
    for (const g of this.geos) this.parts.drop(g);
    this.geos = [];
    this.object.clear();
  }

  /** Draw the marks of `marks` (replacing the last ones). */
  set(marks: TableMarks): void {
    this.clear();
    const s = this.style;
    const name = this.name;
    const drawn: MarksDrawn = { beds: 0, areas: 0, territories: 0, plaques: 0, glyphs: [] };

    if (s.territory) {
      const t = s.territory;
      const shapes = marks.seats.map((seat) => {
        const r = seat.territory;
        return roundedRect(r.w - 2 * t.insetMm, r.d - 2 * t.insetMm, t.radiusMm, r.x, r.y, r.rot);
      });
      drawn.territories = shapes.length;
      this.add(shapes.length ? flatGeometry(shapes, s.top) : null, this.mats.territory, `${name}-territories`, 1);
    }
    if (s.bed) {
      const b = s.bed;
      const shapes = marks.piles.map((p) => roundedRect(CARD_W + 2 * b.padMm, CARD_H + 2 * b.padMm, b.radiusMm, p.x, p.y, p.rot));
      drawn.beds = shapes.length;
      this.add(shapes.length ? flatGeometry(shapes, s.top) : null, this.mats.bed, `${name}-beds`, 2);
    }
    if (s.area) {
      const a = s.area;
      const shapes = marks.areas.map((z) => roundedRect(z.rect.w, z.rect.d, a.radiusMm, z.rect.x, z.rect.y, z.rect.rot));
      drawn.areas = shapes.length;
      this.add(shapes.length ? flatGeometry(shapes, s.top) : null, this.mats.area, `${name}-areas`, 2);
    }

    const named = marks.seats.filter((seat) => seat.avatar !== null);
    if (s.plaque && named.length) {
      const p = s.plaque;
      const raised = s.top - p.baseMm > 0.2;
      const geos = named.map((seat) => {
        const shape = roundedRect(p.lengthMm, p.heightMm, p.heightMm / 2, seat.avatar!.x, seat.avatar!.y, seat.angle);
        return raised ? slabGeometry(shape, s.top, s.top - p.baseMm, Math.min(1.2, (s.top - p.baseMm) / 3)) : flatGeometry(shape, s.top);
      });
      drawn.plaques = named.length;
      this.add(merge(geos), this.mats.plaque, `${name}-plaques`, 0);
      if (p.outline) {
        const segs = named.flatMap((seat) => loopSegments(roundedRectPoints(p.lengthMm, p.heightMm, p.heightMm / 2, seat.avatar!.x, seat.avatar!.y, seat.angle)));
        this.add(lineGeometry(segs, s.top + 0.03), this.mats.outline, `${name}-plaque-outlines`, 3, true);
      }
    }
    const glyphs = named.map((seat) => {
      const c = this.seats[seat.colour] ?? this.seats[0]!;
      const [dx, dy] = rot2(-s.glyph.offsetMm, 0, seat.angle);
      return { seat: seat.index, glyph: c.glyph, colour: c.colour, size: s.glyph.sizeMm, x: seat.avatar!.x + dx, y: seat.avatar!.y + dy, rot: marks.viewerAngle };
    });
    drawn.glyphs = glyphs.map(({ seat, glyph, colour, x, y }) => ({ seat, glyph, colour, x, y }));
    this.add(glyphGeometry(glyphs, s.top + 0.04), this.mats.glyph, `${name}-glyphs`, 3);
    this.drawn = drawn;
  }

  dispose(): void {
    this.clear();
  }
}
