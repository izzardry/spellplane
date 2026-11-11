import * as THREE from 'three';
import { drawPlaceholderFace, type PlaceholderFace } from './placeholder';

/**
 * Bootstrap stage (B0.7 smoke): a white table plane and placeholder cards seen from
 * the bird's-eye rig (6 degree field of view, looking straight down). Milestone 0's
 * scene package replaces this with the full scene.
 * Units are millimetres; table (x, y) maps to world (x, -z) so +y points away from seat 0.
 */
export const CARD_W = 63;
export const CARD_H = 88;

export interface StageCard {
  id: string;
  face: PlaceholderFace;
  x: number;
  y: number;
  rot: number;
}

export interface Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly scene: THREE.Scene;
  addCard(card: StageCard): void;
  /** Screen rectangle (CSS px, viewport-relative) of a card, from its projected corners. */
  cardRect(id: string): DOMRect | null;
  cards(): StageCard[];
  render(): void;
  dispose(): void;
}

export function createStage(host: HTMLElement): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#ffffff');

  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1100),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
  );
  table.rotation.x = -Math.PI / 2;
  scene.add(table);
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1400, 1100)),
    new THREE.LineBasicMaterial({ color: '#d8d8d8' }),
  );
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.01;
  scene.add(edge);

  const camera = new THREE.PerspectiveCamera(6, 1, 10, 100000);
  const fit = () => {
    const w = host.clientWidth || innerWidth;
    const h = host.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    camera.aspect = w / h;
    // Distance so the table depth (1100) plus 5% margin fits the view.
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const needH = 1100 * 1.05;
    const needW = (1400 * 1.05) / camera.aspect;
    const dist = Math.max(needH, needW) / 2 / Math.tan(vfov / 2);
    camera.position.set(0, dist, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  };
  fit();

  const cards = new Map<string, { data: StageCard; mesh: THREE.Mesh }>();
  const cardGeometry = new THREE.PlaneGeometry(CARD_W, CARD_H);

  const render = () => renderer.render(scene, camera);
  const onResize = () => {
    fit();
    render();
  };
  addEventListener('resize', onResize);

  return {
    renderer,
    camera,
    scene,
    addCard(card) {
      const canvas = drawPlaceholderFace(card.face) as HTMLCanvasElement;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const mesh = new THREE.Mesh(cardGeometry, new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = -THREE.MathUtils.degToRad(card.rot);
      mesh.position.set(card.x, 0.1, -card.y);
      scene.add(mesh);
      cards.set(card.id, { data: card, mesh });
    },
    cardRect(id) {
      const c = cards.get(id);
      if (!c) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      c.mesh.updateMatrixWorld();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const v = new THREE.Vector3((sx * CARD_W) / 2, (sy * CARD_H) / 2, 0).applyMatrix4(c.mesh.matrixWorld).project(camera);
        const px = rect.left + ((v.x + 1) / 2) * rect.width;
        const py = rect.top + ((1 - v.y) / 2) * rect.height;
        minX = Math.min(minX, px); maxX = Math.max(maxX, px);
        minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      }
      return new DOMRect(minX, minY, maxX - minX, maxY - minY);
    },
    cards: () => [...cards.values()].map((c) => c.data),
    render,
    dispose() {
      removeEventListener('resize', onResize);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
