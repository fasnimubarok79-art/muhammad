/** Small hand-drawn icon set (20px grid, 1.75 stroke) so the app does not depend on an icon library. */
type P = { className?: string };
const S = ({ children, className = "h-5 w-5" }: P & { children: React.ReactNode }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    {children}
  </svg>
);

export const IconDashboard = (p: P) => <S {...p}><rect x="3" y="3" width="6" height="8" rx="1.5" /><rect x="11" y="3" width="6" height="5" rx="1.5" /><rect x="11" y="10" width="6" height="7" rx="1.5" /><rect x="3" y="13" width="6" height="4" rx="1.5" /></S>;
export const IconClips = (p: P) => <S {...p}><rect x="3" y="2.5" width="6" height="10" rx="1.5" /><rect x="11" y="2.5" width="6" height="10" rx="1.5" /><path d="M3 16h14M3 18h9" /></S>;
export const IconFolder = (p: P) => <S {...p}><path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.5l2 2H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" /></S>;
export const IconFlame = (p: P) => <S {...p}><path d="M10 17.5c3 0 5-2 5-4.8 0-2.6-1.7-4-2.6-5.7-.3 1.3-1 2.1-1.9 2.4.4-2.6-.6-5.1-3-6.9.2 2.9-3.5 5.2-3.5 9.6 0 3.1 2.3 5.4 6 5.4z" /></S>;
export const IconEditor = (p: P) => <S {...p}><rect x="2.5" y="4" width="15" height="9" rx="1.5" /><path d="M8.5 6.8v3.4l3-1.7z" /><path d="M2.5 16h15M6 14.5V17.5M12.5 14.5v3" /></S>;
export const IconSubtitles = (p: P) => <S {...p}><rect x="2.5" y="4" width="15" height="12" rx="2" /><path d="M5.5 11.5h4M11.5 11.5h3M5.5 13.8h2.5M10 13.8h4.5" /></S>;
export const IconExport = (p: P) => <S {...p}><path d="M10 3v9M6.5 8.5 10 12l3.5-3.5" /><path d="M3.5 13.5v1.5a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1.5" /></S>;
export const IconPublish = (p: P) => <S {...p}><path d="M3 10.5 17 3l-3 14-4.5-4.5L3 10.5z" /><path d="m9.5 12.5 1.5 4" /></S>;
export const IconToken = (p: P) => <S {...p}><circle cx="10" cy="10" r="7" /><path d="M10 6v8M7.5 8.2c0-1 1.1-1.7 2.5-1.7s2.5.6 2.5 1.6c0 2.3-5 1.3-5 3.7 0 1 1.1 1.7 2.5 1.7s2.5-.7 2.5-1.7" /></S>;
export const IconSettings = (p: P) => <S {...p}><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></S>;
export const IconShield = (p: P) => <S {...p}><path d="M10 2.5 16 5v4.5c0 4-2.6 6.6-6 8-3.4-1.4-6-4-6-8V5z" /></S>;
export const IconSearch = (p: P) => <S {...p}><circle cx="8.5" cy="8.5" r="5" /><path d="m12.5 12.5 4 4" /></S>;
export const IconBell = (p: P) => <S {...p}><path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 2h-13z" /><path d="M8.5 17.5a1.6 1.6 0 0 0 3 0" /></S>;
export const IconCollapse = (p: P) => <S {...p}><rect x="2.5" y="3" width="15" height="14" rx="2" /><path d="M7.5 3v14M13 8l-2 2 2 2" /></S>;
export const IconExpand = (p: P) => <S {...p}><rect x="2.5" y="3" width="15" height="14" rx="2" /><path d="M7.5 3v14M11 8l2 2-2 2" /></S>;
