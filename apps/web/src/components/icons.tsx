/**
 * Ícones e marca. Sem estado nem eventos: servem tanto às páginas renderizadas
 * no servidor (página inicial) quanto ao editor.
 */
type IconProps = { className?: string; size?: number };
const svg = (path: React.ReactNode) =>
  function Icon({ className, size = 16 }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        {path}
      </svg>
    );
  };

/** Ícones de traço, no mesmo desenho, para toda a interface. */
export const Icon = {
  undo: svg(<path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />),
  redo: svg(<path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />),
  scissors: svg(
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
    </>,
  ),
  split: svg(<path d="M12 3v18M7 8 3 12l4 4M17 8l4 4-4 4" />),
  wand: svg(<path d="m15 4 5 5L9 20l-5-5L15 4ZM14 8l2 2M5 3v4M3 5h4M19 15v4M17 17h4" />),
  sparkles: svg(<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />),
  trash: svg(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />),
  x: svg(<path d="M6 6l12 12M18 6 6 18" />),
  play: svg(<path d="M7 4.5v15l13-7.5-13-7.5Z" fill="currentColor" stroke="none" />),
  pause: svg(<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" fill="currentColor" stroke="none" />),
  zoomIn: svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
    </>,
  ),
  captions: svg(
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M7 12h4M7 15h7M14 12h3" />
    </>,
  ),
  layers: svg(<path d="m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5" />),
  frame: svg(
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M3 8v8M21 8v8" />
    </>,
  ),
  palette: svg(
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2 0-1.6 1-2.5 2.5-2.5H18a3 3 0 0 0 3-3c0-5.5-4-10.5-9-10.5Z" />
      <circle cx="7.5" cy="11.5" r="1" fill="currentColor" />
      <circle cx="11" cy="7.5" r="1" fill="currentColor" />
      <circle cx="16" cy="9" r="1" fill="currentColor" />
    </>,
  ),
  download: svg(<path d="M12 4v11M7 11l5 5 5-5M5 20h14" />),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  chevron: svg(<path d="m6 9 6 6 6-6" />),
  check: svg(<path d="m5 12.5 4.5 4.5L19 7" />),
  send: svg(<path d="M4 12 20 4l-6 16-3-7-7-1Z" />),
  move: svg(<path d="M12 3v18M3 12h18M12 3 9 6M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />),
  type: svg(<path d="M5 6V4h14v2M12 4v16M9 20h6" />),
  eyeOff: svg(<path d="M3 3l18 18M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-3.2 3.6M6.5 7.6A15 15 0 0 0 3 12s4 6 9 6c1.2 0 2.3-.3 3.3-.8M9.9 9.9a3 3 0 0 0 4.2 4.2" />),
  eye: svg(
    <>
      <path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6Z" />
      <circle cx="12" cy="12" r="3" />
    </>,
  ),
  bolt: svg(<path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" />),
  shield: svg(<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3ZM9 12l2 2 4-4" />),
  chart: svg(<path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />),
  clock: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  mic: svg(
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>,
  ),
  film: svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>,
  ),
  fit: svg(<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />),
  mail: svg(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>,
  ),
};

/** Marca: um quadro de vídeo com o corte no meio. */
export function Logo({ size = 26, withName = true }: { size?: number; withName?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8f7bff" />
            <stop offset="1" stopColor="#4f9dff" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#lg)" />
        <path d="M12.5 10.2v11.6l9.5-5.8-9.5-5.8Z" fill="white" />
      </svg>
      {withName && <span className="text-[15px] font-semibold tracking-tight text-white">videoeditor</span>}
    </span>
  );
}
