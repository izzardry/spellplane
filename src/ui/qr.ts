/**
 * QR codes for invite links (journey.md 4.8, 4.11; visual.md 2.7 QrPlate; PLAN M8-C "Shared glue"): the module matrix of
 * a text, drawn by ui/design/QrPlate.svelte. `qrcode-generator` (MIT, docs/ASSETS.md) is imported lazily, so pages
 * without an invite never load it. Added by M8-C.
 */

/** The QR matrix of `text` (true = dark module, error correction M), or null when the text is too long for a QR code. */
export async function qrMatrix(text: string): Promise<boolean[][] | null> {
  const { default: qrcode } = await import('qrcode-generator');
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
  } catch {
    // "code length overflow": more than a version 40 code holds.
    return null;
  }
}
