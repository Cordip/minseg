import { useEffect, useRef, useState, memo } from 'react';
import type { PatchCoord, PatchState, MinimapData, SegProgress, PatchStats } from '../types';

interface Props {
  minimapData: MinimapData | null;
  currentPatch: PatchCoord;
  gridSize: { rows: number; cols: number };
  patchStates: Record<string, PatchState>;
  segProgress: SegProgress;
  patchStats: PatchStats;
  onNavigate: (patch: PatchCoord) => void;
}

function MinimapInner({ minimapData, currentPatch, gridSize, patchStates, segProgress, patchStats, onNavigate }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [animTick, setAnimTick] = useState(0);

  useEffect(() => {
    const hasActive = Object.values(patchStates).some(s => s === 'active');
    if (!hasActive) return;
    const timer = setInterval(() => setAnimTick(t => t + 1), 200);
    return () => clearInterval(timer);
  }, [patchStates]);

  useEffect(() => {
    if (!minimapData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width; canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      const cw = canvas.width / gridSize.cols;
      const ch = canvas.height / gridSize.rows;
      for (let py = 0; py < gridSize.rows; py++) {
        for (let px = 0; px < gridSize.cols; px++) {
          const st = patchStates[`${py},${px}`];
          if (st === 'pending') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.fillRect(px * cw, py * ch, cw, ch);
          } else if (st === 'active') {
            ctx.fillStyle = 'rgba(74, 158, 255, 0.3)';
            ctx.fillRect(px * cw, py * ch, cw, ch);
            const cx = px * cw + cw / 2, cy = py * ch + ch / 2;
            const r = Math.min(cw, ch) * 0.2;
            ctx.strokeStyle = '#4a9eff'; ctx.lineWidth = 2;
            ctx.beginPath();
            const t = Date.now() / 500;
            ctx.arc(cx, cy, r, t, t + Math.PI * 1.4);
            ctx.stroke();
          }
        }
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
      for (let i = 0; i <= gridSize.cols; i++) { ctx.beginPath(); ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, canvas.height); ctx.stroke(); }
      for (let j = 0; j <= gridSize.rows; j++) { ctx.beginPath(); ctx.moveTo(0, j * ch); ctx.lineTo(canvas.width, j * ch); ctx.stroke(); }
      ctx.strokeStyle = '#ff4757'; ctx.lineWidth = 3;
      ctx.strokeRect(currentPatch.x * cw, currentPatch.y * ch, cw, ch);
      ctx.fillStyle = 'rgba(255, 71, 87, 0.2)';
      ctx.fillRect(currentPatch.x * cw, currentPatch.y * ch, cw, ch);
    };
    img.src = 'data:image/png;base64,' + minimapData.image;
  }, [minimapData, currentPatch, gridSize, patchStates, animTick]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / rect.width * gridSize.cols);
    const y = Math.floor((e.clientY - rect.top) / rect.height * gridSize.rows);
    onNavigate({ y: Math.max(0, Math.min(gridSize.rows - 1, y)), x: Math.max(0, Math.min(gridSize.cols - 1, x)) });
  };

  const pct = segProgress.total > 0 ? Math.round(segProgress.done / segProgress.total * 100) : 0;
  return (
    <div className="minimap-panel">
      <div className="minimap-header">Миникарта</div>
      <div style={{ padding: 10 }}>
        <canvas ref={canvasRef} onClick={handleClick} style={{ width: '100%', cursor: 'pointer', display: 'block' }} />
      </div>
      {segProgress.total > 0 && (
        <div style={{ padding: '0 10px 10px 10px' }}>
          <div style={{ width: '100%', height: 16, backgroundColor: '#2a2a3e', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', backgroundColor: segProgress.done >= segProgress.total ? '#28a745' : '#4a9eff', borderRadius: 8, transition: 'width 0.3s ease' }} />
          </div>
          <div style={{ textAlign: 'center', fontSize: 13, color: '#aaa', marginTop: 4 }}>{`${segProgress.done} / ${segProgress.total} (${pct}%) | Осталось: ${segProgress.untagged}`}</div>
          <div style={{ textAlign: 'center', fontSize: 13, color: '#aaa', marginTop: 2 }}>{`Патч: ${patchStats.tagged} / ${patchStats.total} | Осталось: ${patchStats.total - patchStats.tagged}`}</div>
        </div>
      )}
    </div>
  );
}

const Minimap = memo(MinimapInner, (prev, next) =>
  prev.minimapData === next.minimapData && prev.currentPatch.y === next.currentPatch.y
  && prev.currentPatch.x === next.currentPatch.x && prev.patchStates === next.patchStates
  && prev.segProgress === next.segProgress && prev.patchStats === next.patchStats && prev.gridSize === next.gridSize
);

export default Minimap;
