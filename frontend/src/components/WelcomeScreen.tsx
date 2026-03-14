import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type { Api } from '../api';

interface Props {
  api: Api;
  onReady: (gridSize: { rows: number; cols: number }) => void;
}

interface FileSlot {
  path: string | null;
  name: string;
}

const IMAGE_TYPES = ['ppl45', 'ppl90', 'xpl45', 'xpl90'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
type FileMap = Record<ImageType, FileSlot>;
const LABELS: Record<ImageType, string> = {
  ppl45: 'PPL 45\u00b0',
  ppl90: 'PPL 90\u00b0',
  xpl45: 'XPL 45\u00b0',
  xpl90: 'XPL 90\u00b0',
};
const DESCS: Record<ImageType, string> = {
  ppl45: '\u041f\u0430\u0440\u0430\u043b\u043b\u0435\u043b\u044c\u043d\u044b\u0439 \u043d\u0438\u043a\u043e\u043b\u044c, 45\u00b0',
  ppl90: '\u041f\u0430\u0440\u0430\u043b\u043b\u0435\u043b\u044c\u043d\u044b\u0439 \u043d\u0438\u043a\u043e\u043b\u044c, 90\u00b0',
  xpl45: '\u0421\u043a\u0440\u0435\u0449\u0435\u043d\u043d\u044b\u0439 \u043d\u0438\u043a\u043e\u043b\u044c, 45\u00b0',
  xpl90: '\u0421\u043a\u0440\u0435\u0449\u0435\u043d\u043d\u044b\u0439 \u043d\u0438\u043a\u043e\u043b\u044c, 90\u00b0',
};

export default function WelcomeScreen({ api, onReady }: Props) {
  const [files, setFiles] = useState<FileMap>({
    ppl45: { path: null, name: '' },
    ppl90: { path: null, name: '' },
    xpl45: { path: null, name: '' },
    xpl90: { path: null, name: '' },
  });
  const [status, setStatus] = useState('');
  const [statusType, setStatusType] = useState<'' | 'error' | 'success'>('');
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const allSelected = IMAGE_TYPES.every(t => files[t].path !== null);

  const selectFile = async (type: ImageType) => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp'] }],
      });
      if (typeof selected === 'string') {
        const name = selected.split(/[/\\]/).pop() ?? selected;
        setFiles(prev => ({ ...prev, [type]: { path: selected, name } }));
        setStatus('');
        setStatusType('');
      }
    } catch (e) {
      setStatus(`\u041e\u0448\u0438\u0431\u043a\u0430: ${e}`);
      setStatusType('error');
    }
  };

  const clearAll = () => {
    setFiles({
      ppl45: { path: null, name: '' },
      ppl90: { path: null, name: '' },
      xpl45: { path: null, name: '' },
      xpl90: { path: null, name: '' },
    });
    setStatus('');
    setStatusType('');
  };

  const startProcessing = async () => {
    if (!allSelected) return;
    setIsProcessing(true);
    try {
      setProgress(10);
      setStatus('\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0439...');

      await api.loadPaths({
        ppl45: files.ppl45.path!,
        ppl90: files.ppl90.path!,
        xpl45: files.xpl45.path!,
        xpl90: files.xpl90.path!,
      });
      setProgress(30);
      setStatus('\u0412\u044b\u0440\u0430\u0432\u043d\u0438\u0432\u0430\u043d\u0438\u0435 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0439...');

      const alignData = await api.alignImages();
      setProgress(50);
      setStatus('\u0417\u0430\u043f\u0443\u0441\u043a \u0441\u0435\u0433\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u0438...');

      api.startSegmentation().catch(() => {});
      setProgress(100);
      setStatus('\u0413\u043e\u0442\u043e\u0432\u043e!');
      setStatusType('success');

      onReady(alignData.grid_size);
    } catch (e) {
      setStatus(`\u041e\u0448\u0438\u0431\u043a\u0430: ${e}`);
      setStatusType('error');
      setIsProcessing(false);
    }
  };

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: 40, background: '#1a1a2e',
    }}>
      <h1 style={{ fontSize: 32, color: '#e94560', marginBottom: 10, textAlign: 'center' }}>
        Mineral Segmentation
      </h1>
      <p style={{ color: '#888', textAlign: 'center', marginBottom: 40, fontSize: 14 }}>
        {'\u0421\u0435\u0433\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u044f \u043c\u0438\u043d\u0435\u0440\u0430\u043b\u044c\u043d\u044b\u0445 \u0437\u0435\u0440\u0435\u043d \u043f\u043e \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f\u043c \u043f\u043e\u043b\u044f\u0440\u0438\u0437\u043e\u0432\u0430\u043d\u043d\u043e\u0439 \u043c\u0438\u043a\u0440\u043e\u0441\u043a\u043e\u043f\u0438\u0438'}
      </p>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20,
        marginBottom: 30, maxWidth: 700, width: '100%',
      }}>
        {IMAGE_TYPES.map(type => (
          <div key={type} style={{
            background: '#16213e', borderRadius: 12, padding: 20,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            border: `2px solid ${files[type].path ? '#4ecca3' : 'transparent'}`,
          }}>
            <h3 style={{ color: '#fff', marginBottom: 8, fontSize: 16 }}>{LABELS[type]}</h3>
            <p style={{ color: '#666', fontSize: 12, marginBottom: 15, textAlign: 'center' }}>{DESCS[type]}</p>
            <p style={{
              color: '#4ecca3', fontSize: 11, marginBottom: 10, maxWidth: '100%',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textAlign: 'center', minHeight: 16,
            }}>
              {files[type].name}
            </p>
            <button
              onClick={() => selectFile(type)}
              disabled={isProcessing}
              style={{
                background: files[type].path ? '#4ecca3' : '#0f3460',
                color: files[type].path ? '#16213e' : '#eaeaea',
                border: '1px solid #4ecca3', padding: '10px 20px',
                fontSize: 14, borderRadius: 6, cursor: isProcessing ? 'not-allowed' : 'pointer',
                width: '100%',
              }}
            >
              {files[type].path ? '\u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c' : '\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u0444\u0430\u0439\u043b'}
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 15, justifyContent: 'center', marginTop: 20 }}>
        <button
          onClick={clearAll}
          disabled={isProcessing}
          style={{
            background: 'transparent', color: '#888', border: '1px solid #555',
            padding: '16px 30px', fontSize: 14, borderRadius: 8, cursor: 'pointer',
          }}
        >
          {'\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c \u0432\u0441\u0435'}
        </button>
        <button
          onClick={startProcessing}
          disabled={!allSelected || isProcessing}
          style={{
            background: allSelected && !isProcessing ? '#e94560' : '#555',
            color: 'white', border: 'none', padding: '16px 40px',
            fontSize: 16, borderRadius: 8,
            cursor: allSelected && !isProcessing ? 'pointer' : 'not-allowed',
          }}
        >
          {'\u041d\u0430\u0447\u0430\u0442\u044c \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u043a\u0443'}
        </button>
      </div>

      {status && (
        <p style={{
          marginTop: 20, fontSize: 14, textAlign: 'center',
          color: statusType === 'error' ? '#e94560' : statusType === 'success' ? '#4ecca3' : '#888',
        }}>
          {status}
        </p>
      )}

      {isProcessing && (
        <div style={{ marginTop: 20, width: '100%', maxWidth: 700 }}>
          <div style={{ width: '100%', height: 8, background: '#16213e', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${progress}%`,
              background: 'linear-gradient(90deg, #e94560, #4ecca3)',
              transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}
