/** The default official release (18 Oct 2026, 6:00 PM IST). The server's per-exam value wins; this is only the display fallback. */
export const DEFAULT_RELEASE_ISO = '2026-10-18T12:30:00.000Z';

/** "18 October 2026 at 6:00 PM IST" */
export const formatReleaseIST = (iso?: string | null): string => {
  const d = new Date(iso || DEFAULT_RELEASE_ISO);
  if (Number.isNaN(d.getTime())) return '18 October 2026 at 6:00 PM IST';
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  return `${date} at ${time} IST`;
};

export const releaseNotice = (iso?: string | null) =>
  `Your certificates will be available after the official results are published on ${formatReleaseIST(iso)}.`;
