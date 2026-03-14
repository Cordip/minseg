import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { createApi, type Api } from './api';

export default function App() {
  const [api, setApi] = useState<Api | null>(null);
  const [status, setStatus] = useState<string>('Starting backend...');

  useEffect(() => {
    const init = async () => {
      try {
        const apiUrl = await invoke<string>('get_api_url');
        const newApi = createApi(apiUrl);

        // Poll until backend is ready
        for (let i = 0; i < 30; i++) {
          try {
            const data = await newApi.getStatus();
            setApi(newApi);
            setStatus(`Connected. Aligned: ${data.images_aligned}`);
            return;
          } catch {
            setStatus(`Waiting for backend... (${i + 1}/30)`);
            await new Promise(r => setTimeout(r, 500));
          }
        }
        setStatus('Backend failed to start');
      } catch (e) {
        setStatus(`Error: ${e}`);
      }
    };
    init();
  }, []);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#1a1a2e',
      color: '#eaeaea',
      fontFamily: 'system-ui',
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1>Mineral Segmentation v2</h1>
        <p>Tauri + Vite + React 19 + TypeScript</p>
        <p>Backend: {status}</p>
        {api && <p style={{ color: '#4a9eff' }}>API client ready (24 endpoints typed)</p>}
      </div>
    </div>
  );
}
