/**
 * "Talk while I hold or drag" between the scene and the voice controller (DESIGN "Chat and voice", Talk modes; PLAN
 * Milestone 6, owner decisions, Hold-to-talk: "Dictation captions attach to the dragged card as usual"). Implementer:
 * M6-P2.
 *
 * The scene reports a table press held past HOLD_PRESS_TALK_MS (SceneEvents.pressHold); this forwards it to
 * VoiceControls.pressHeld, which talks only while the setting is on, never for a spectator and never while a text field
 * has focus (voice/mic.ts). The card under the press when it went down is the caption anchor while the press talks, so
 * words said while dragging a card attach to that card (the scene stops reporting a hover once a drag starts).
 */
import type { InstanceId } from '../../core/types';
import type { TablePressKind } from '../../scene/types';
import type { VoiceControls } from '../../voice/types';

export interface PressTalkHost {
  /** The table's live voice; absent at the solo table. */
  voice: Pick<VoiceControls, 'pressHeld'> | null | undefined;
  /** The topmost card under a screen point (TableScene.cardAt); null where there is none or no scene. */
  cardAt(x: number, y: number): InstanceId | null;
  /** The card a talking press holds changed (null when the press ended or holds no card): the caption anchor. */
  onAnchor?(card: InstanceId | null): void;
}

export class PressTalk {
  /** The card under the press when it went down. */
  private downCard: InstanceId | null = null;
  /** The card of the press that is talking now. */
  private heldCard: InstanceId | null = null;
  private talking = false;

  constructor(private readonly host: PressTalkHost) {}

  /** A pointer went down on the table (before the scene reacts to it). A finger joining a held press changes nothing. */
  down(x: number, y: number): void {
    if (this.talking) return;
    try {
      this.downCard = this.host.cardAt(x, y);
    } catch {
      this.downCard = null;
    }
  }

  /** A card dragged out of the hand or a pile viewer onto the table: that press holds this card. */
  dragOut(card: InstanceId): void {
    if (!this.talking) this.downCard = card;
  }

  /** SceneEvents.pressHold. */
  hold(phase: 'start' | 'end', kind: TablePressKind): void {
    if (phase === 'start') {
      if (this.talking) return;
      this.talking = true;
      this.heldCard = kind === 'card' ? this.downCard : null;
      // The anchor first: a caption that starts with the mic opening already knows its card.
      if (this.heldCard) this.host.onAnchor?.(this.heldCard);
      this.host.voice?.pressHeld?.(true);
      return;
    }
    if (!this.talking) return;
    this.talking = false;
    this.host.voice?.pressHeld?.(false);
    const had = this.heldCard;
    this.heldCard = null;
    this.downCard = null;
    if (had) this.host.onAnchor?.(null);
  }

  /** The card a talking press holds, else null. */
  anchorCard(): InstanceId | null {
    return this.heldCard;
  }

  /** A held press ends with the HUD. */
  dispose(): void {
    if (this.talking) this.hold('end', 'other');
  }
}
