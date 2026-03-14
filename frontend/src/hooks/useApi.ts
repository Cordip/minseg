import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { createApi, type Api } from '../api';

export function useApi() {
  const [api, setApi] = useState<Api | null>(null);
  const [apiUrl, setApiUrl] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [status, setStatus] = useState('Starting backend...');

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        let url: string;
        try {
          url = await invoke<string>('get_api_url');
        } catch {
          // Fallback for dev without Tauri (plain browser)
          url = 'http://127.0.0.1:8001';
        }
        if (cancelled) return;
        setApiUrl(url);
        const newApi = createApi(url);

        for (let i = 0; i < 30; i++) {
          if (cancelled) return;
          try {
            await newApi.getStatus();
            setApi(newApi);
            setIsReady(true);
            setStatus('Connected');
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
    return () => { cancelled = true; };
  }, []);

  return { api, apiUrl, isReady, status };
}
