// Deterministic vibrant color from tag name (DJB2 hash + golden ratio hue)
export function tagColor(name: string): string {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash) + name.charCodeAt(i);
  }
  const hue = Math.abs(hash * 137.5) % 360;
  const s = 0.85;
  const l = 0.55;
  const h = hue / 360;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);
  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Russian plural form for "segment"
export function pluralSeg(n: number): string {
  const m = n % 100;
  const d = n % 10;
  if (d === 1 && m !== 11) return 'сегмент';
  if (d >= 2 && d <= 4 && (m < 12 || m > 14)) return 'сегмента';
  return 'сегментов';
}

// Draw base64 image onto a canvas element
export function drawOnCanvas(
  canvas: HTMLCanvasElement | null,
  base64Data: string | null | undefined,
): void {
  if (!canvas || !base64Data) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };
  img.src = 'data:image/png;base64,' + base64Data;
}

// Draw green diagonal stripes selection mask
export function drawSelectionStripes(
  canvas: HTMLCanvasElement | null,
  maskBase64: string | null | undefined,
): void {
  if (!canvas || !maskBase64) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const maskImg = new Image();
  maskImg.onload = () => {
    canvas.width = maskImg.width;
    canvas.height = maskImg.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(maskImg, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    const patCanvas = document.createElement('canvas');
    patCanvas.width = 8;
    patCanvas.height = 8;
    const pc = patCanvas.getContext('2d')!;
    pc.strokeStyle = '#00ff00';
    pc.lineWidth = 2;
    pc.beginPath();
    pc.moveTo(0, 8); pc.lineTo(8, 0);
    pc.moveTo(-2, 2); pc.lineTo(2, -2);
    pc.moveTo(6, 10); pc.lineTo(10, 6);
    pc.stroke();
    const pattern = ctx.createPattern(patCanvas, 'repeat')!;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  };
  maskImg.src = 'data:image/png;base64,' + maskBase64;
}
