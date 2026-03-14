import { useState, useEffect, useRef, useCallback } from 'react';
import type { Api } from '../api';
import type { PatchCoord, SegProgress, PatchStats, PatchState, MinimapData } from '../types';

export function useSegmentation(
  api: Api | null,
  currentPatch: PatchCoord,
  currentView: string,
  imagesAligned: boolean,
  _gridSize: { rows: number; cols: number },
) {
  const [patchReady, setPatchReady] = useState(false);
  const [segProgress, setSegProgress] = useState<SegProgress>({ done: 0, total: 0, untagged: 0 });
  const [patchStates, setPatchStates] = useState<Record<string, PatchState>>({});
  const [patchStats, setPatchStats] = useState<PatchStats>({ total: 0, tagged: 0 });
  const [showUntagged, setShowUntagged] = useState(false);

  // Image data as base64 strings
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [segImage, setSegImage] = useState<string | null>(null);
  const [boundsImage, setBoundsImage] = useState<string | null>(null);
  const [bordersImage, setBordersImage] = useState<string | null>(null);
  const [untaggedImage, setUntaggedImage] = useState<string | null>(null);
  const [minimapData, setMinimapData] = useState<MinimapData | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const isProcessingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);

  // Load background image (lightweight, immediate)
  const loadBackgroundData = useCallback(() => {
    if (!api || !imagesAligned) return;
    api.getPatch(currentPatch.y, currentPatch.x, currentView)
      .then(d => setBgImage(d.image))
      .catch(() => {});
  }, [api, currentPatch, currentView, imagesAligned]);

  // Load segmentation data (heavy, debounced)
  const loadSegmentationData = useCallback(() => {
    if (!api || !imagesAligned) return;
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPatchReady(false);

    api.getSegmentation(currentPatch.y, currentPatch.x, ac.signal)
      .then(d => {
        if (ac.signal.aborted) return;
        if (d.status === 'ready') {
          setPatchStats({ total: d.total_segs ?? 0, tagged: d.tagged_segs ?? 0 });
          setSegImage(d.colored_segments ?? null);
          setBoundsImage(d.bounds ?? null);
          setBordersImage(d.borders ?? null);
          setPatchReady(true);
        } else {
          setSegImage(null);
          setBoundsImage(null);
          setBordersImage(null);
          api.requestPatchPriority(currentPatch.y, currentPatch.x).catch(() => {});
        }
      })
      .catch(() => {});
  }, [api, currentPatch, imagesAligned]);

  // Poll segmentation progress (2s when processing, 5s when idle)
  useEffect(() => {
    if (!api || !imagesAligned) return;
    let timer: ReturnType<typeof setTimeout>;
    const fetchProgress = () => {
      api.getStatus().then(s => {
        setSegProgress({ done: s.segmented_patches, total: s.total_patches, untagged: s.untagged_segments });
        isProcessingRef.current = s.is_segmenting;
      }).catch(() => {});
      api.getProgress().then(p => {
        if (!p.is_running && (!p.processed || p.processed.length === 0)) return;
        const map: Record<string, PatchState> = {};
        (p.processed || []).forEach(([py, px]) => { map[`${py},${px}`] = 'processed'; });
        (p.current_active || []).forEach(([py, px]) => { map[`${py},${px}`] = 'active'; });
        (p.pending || []).forEach(([py, px]) => { map[`${py},${px}`] = 'pending'; });
        setPatchStates(map);
      }).catch(() => {});
    };
    const tick = () => {
      fetchProgress();
      timer = setTimeout(tick, isProcessingRef.current ? 2000 : 5000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [api, imagesAligned]);

  // Debounced segmentation load (300ms after patch changes)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!loadingRef.current) {
        loadingRef.current = true;
        loadSegmentationData();
        setTimeout(() => { loadingRef.current = false; }, 500);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [loadSegmentationData]);

  // Immediate background + minimap load
  useEffect(() => {
    loadBackgroundData();
    if (api && imagesAligned) {
      api.getMinimap(currentView).then(setMinimapData).catch(() => {});
    }
  }, [loadBackgroundData, currentView, api, imagesAligned]);

  // Poll for patch ready (2s) when not ready
  useEffect(() => {
    if (patchReady || !api) return;
    const itv = setInterval(() => {
      if (loadingRef.current) return;
      api.getSegmentation(currentPatch.y, currentPatch.x).then(d => {
        if (d.status === 'ready') {
          setPatchStats({ total: d.total_segs ?? 0, tagged: d.tagged_segs ?? 0 });
          setSegImage(d.colored_segments ?? null);
          setBoundsImage(d.bounds ?? null);
          setBordersImage(d.borders ?? null);
          setPatchReady(true);
        }
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(itv);
  }, [api, currentPatch, patchReady]);

  const toggleUntagged = useCallback(() => {
    setShowUntagged(prev => {
      const next = !prev;
      if (next && api) {
        api.getUntaggedMask(currentPatch.y, currentPatch.x)
          .then(d => setUntaggedImage(d.image))
          .catch(() => {});
      }
      return next;
    });
  }, [api, currentPatch]);

  const startSegmentation = useCallback(() => {
    if (!api) return;
    api.startSegmentation().catch(() => {});
  }, [api]);

  const reloadPatch = useCallback(() => {
    loadSegmentationData();
  }, [loadSegmentationData]);

  return {
    patchReady, segProgress, patchStates, patchStats,
    showUntagged, bgImage, segImage, boundsImage, bordersImage,
    untaggedImage, minimapData,
    toggleUntagged, startSegmentation, reloadPatch, setPatchReady,
  };
}
