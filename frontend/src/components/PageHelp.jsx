import React, { useEffect, useRef, useState } from 'react';

/**
 * PageHelp — info-icon button with click-to-toggle popover panduan.
 * Usage: <PageHelp title="Judul" items={["Poin 1", "Poin 2"]} />
 * Or:    <PageHelp title="Judul">{custom JSX}</PageHelp>
 */
export default function PageHelp({ title = 'Panduan', items, children, className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  return (
    <div className={`relative inline-block ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Panduan halaman"
        aria-label="Panduan halaman"
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-prestisa-100 text-prestisa-700 hover:bg-prestisa-200 transition text-sm font-bold"
      >
        ?
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[90vw] bg-white border border-prestisa-200 rounded-lg shadow-xl p-3 text-sm text-prestisa-800">
          <div className="flex items-start justify-between mb-2 gap-2">
            <h4 className="font-semibold text-prestisa-900">💡 {title}</h4>
            <button onClick={() => setOpen(false)} className="text-xs text-prestisa-500 hover:text-prestisa-700">✕</button>
          </div>
          {items && (
            <ul className="list-disc pl-5 space-y-1 text-xs leading-relaxed">
              {items.map((it, i) => <li key={i}>{it}</li>)}
            </ul>
          )}
          {children && <div className="text-xs leading-relaxed">{children}</div>}
        </div>
      )}
    </div>
  );
}
