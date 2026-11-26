import React, { useEffect, useState } from 'react';
import { Maximize2, Minimize2, X, ZoomIn, ZoomOut } from 'lucide-react';

interface ImageLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  fileName?: string;
}

const ZOOM_STEPS = [1, 1.5, 2, 2.5, 3];

export function ImageLightboxModal({
  isOpen,
  onClose,
  imageUrl,
  fileName,
}: ImageLightboxModalProps) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!isOpen) return;
    setZoom(1);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') {
        setZoom((z) => Math.min(3, Math.round((z + 0.5) * 10) / 10));
      }
      if (e.key === '-') {
        setZoom((z) => Math.max(1, Math.round((z - 0.5) * 10) / 10));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-xs flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={fileName ? `Enlarged source image: ${fileName}` : 'Enlarged source image'}
      onClick={onClose}
    >
      {/* Top Toolbar */}
      <div
        className="px-4 py-3 flex items-center justify-between gap-3 bg-black/60 text-white shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs sm:text-sm font-medium truncate">
          {fileName || 'Source quote image'}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.5) * 10) / 10))}
            disabled={zoom <= 1}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 cursor-pointer"
            aria-label="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="font-num text-xs min-w-[3.2rem] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.5) * 10) / 10))}
            disabled={zoom >= 3}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 cursor-pointer"
            aria-label="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
            className="px-2.5 py-1.5 text-xs rounded-lg bg-white/10 hover:bg-white/20 inline-flex items-center gap-1 cursor-pointer"
          >
            {zoom === 1 ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
            {zoom === 1 ? '200%' : 'Fit'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/25 ml-1 cursor-pointer"
            aria-label="Close enlarged image"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrollable Pan & Zoom Container */}
      <div
        className="flex-1 overflow-auto p-4 sm:p-8 flex items-start justify-center"
        onClick={onClose}
      >
        <img
          src={imageUrl}
          alt={fileName || 'Enlarged source quote'}
          onClick={(e) => {
            e.stopPropagation();
            const nextIdx = (ZOOM_STEPS.findIndex((s) => s >= zoom) + 1) % ZOOM_STEPS.length;
            setZoom(ZOOM_STEPS[nextIdx]);
          }}
          style={{
            width: zoom === 1 ? 'auto' : `${zoom * 100}%`,
            maxWidth: zoom === 1 ? '100%' : 'none',
            maxHeight: zoom === 1 ? 'calc(100vh - 7rem)' : 'none',
          }}
          className="rounded-lg shadow-2xl object-contain transition-all duration-150 cursor-zoom-in select-none"
        />
      </div>
    </div>
  );
}
