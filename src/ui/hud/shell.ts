/**
 * Whether the table HUD honours every `HudShellProps` member (docs/design/m8/contracts.md Part C; PLAN M8-C "HUD and
 * scene seam"). False until M7-P2 rebuilds the HUD: while false, the table frame (ui/table/TableFrame.svelte) shows its
 * fallback bar (Leave, the `primaryOverride` button, the status). M7-P2 sets it true. Added by M8-C.
 */
export const HUD_SHELL: boolean = false;
