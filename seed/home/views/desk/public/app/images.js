// Images the owner pastes, drops or picks into the chat composer, made ready to send: formats every
// agent's model reads, at a size they accept. Scaled and re-encoded only when too big or unsendable.
export const MAX_PROMPT_IMAGES = 6;
const MAX_EDGE = 2000;          // longest edge sent: larger costs more and gains little for a model
const MAX_BYTES = 3_000_000;    // agentd keeps an image to 4 MiB of base64
const SENDABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export const imageFiles = (files) => [...(files || [])].filter((f) => f.type?.startsWith('image/'));

const base64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => reject(r.error || new Error("Couldn't read the image"));
  r.readAsDataURL(blob);
});
const canvasBlob = (canvas, type, quality) => new Promise((resolve, reject) =>
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the image"))), type, quality));

// { mimeType, data (base64), name, url (for a thumbnail) }
export async function promptImage(file) {
  const name = file.name || undefined;
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error(`${file.name || 'That file'} isn't an image Springroll can read`); });
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    let blob = file;
    if (scale < 1 || !SENDABLE.has(file.type) || file.size > MAX_BYTES) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      // PNG keeps a screenshot's text crisp; a large photo goes as JPEG.
      blob = await canvasBlob(canvas, 'image/png');
      if (blob.size > MAX_BYTES) blob = await canvasBlob(canvas, 'image/jpeg', 0.88);
      if (blob.size > MAX_BYTES) throw new Error(`${file.name || 'That image'} is too large to send`);
    }
    return { mimeType: blob.type, data: await base64(blob), name, url: URL.createObjectURL(blob) };
  } finally {
    bitmap.close();
  }
}
