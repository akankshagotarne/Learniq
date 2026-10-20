import React from 'react';
import { EventOption, STATUS_LABEL } from '../../services/olympiadEvents';

/** One shared "Olympiad Event" dropdown. No "All events" option exists on purpose. */
const EventSelector: React.FC<{ value: string; options: EventOption[]; onChange: (id: string) => void; loading?: boolean; error?: string }> = ({ value, options, onChange, loading, error }) => (
  <label className="block min-w-0" data-testid="event-selector">
    <span className="block text-[11px] font-semibold text-text-muted mb-1">Olympiad Event</span>
    <select
      className="w-full text-sm rounded-xl border border-border-subtle bg-surface px-3 py-2 text-text-primary"
      value={value} disabled={loading || options.length === 0} onChange={e => onChange(e.target.value)} data-testid="event-select"
    >
      {loading && <option value="">Loading events…</option>}
      {!loading && options.length === 0 && <option value="">No Olympiad events yet</option>}
      {options.map(o => <option key={o._id} value={o._id}>{o.name} · {STATUS_LABEL[o.status]}</option>)}
    </select>
    {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
  </label>
);
export default EventSelector;
