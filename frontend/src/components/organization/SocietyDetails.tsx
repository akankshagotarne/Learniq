import React from 'react';
import { Building2, FileBadge2, Mail, MapPin, Phone } from 'lucide-react';
import { SOCIETY, telHref } from '../../constants/organization';

/**
 * Virat Education Society's official details as readable, selectable text (never a scanned letterhead).
 * `compact` is the Contact-page version (office + contacts only); the full card is on the About page.
 */
const SocietyDetails: React.FC<{ compact?: boolean; headingLevel?: 'h2' | 'h3' }> = ({ compact = false, headingLevel = 'h3' }) => {
  const H = headingLevel;
  return (
    <section className="card-soft p-6 sm:p-8 rounded-card border border-border-subtle" aria-labelledby="society-details-title" data-testid={compact ? 'society-contact' : 'society-details'} itemScope itemType="https://schema.org/Organization">
      <div className="flex items-center gap-4 mb-6">
        <img src={SOCIETY.emblem} alt={`${SOCIETY.name} emblem`} width={72} height={72} loading="lazy" className="w-16 h-16 sm:w-[72px] sm:h-[72px] object-contain flex-shrink-0 rounded-full bg-white" />
        <div className="min-w-0">
          <H id="society-details-title" className="font-heading font-bold text-lg sm:text-xl text-text-primary uppercase tracking-wide" itemProp="name">{SOCIETY.name}</H>
          <p className="text-text-secondary text-xs sm:text-sm">{compact ? 'Registered office & contact of the society LearnIQ operates under' : 'Official organisation details'}</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {!compact && (
          <div>
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3"><FileBadge2 className="w-4 h-4 text-brand-primary" aria-hidden="true" /> Registration</h4>
            <dl className="space-y-3 text-sm" data-testid="society-registrations">
              <div>
                <dt className="text-text-muted text-xs">Organisation</dt>
                <dd className="text-text-primary font-semibold">{SOCIETY.name}</dd>
              </div>
              {SOCIETY.registrations.map((r, i) => (
                <div key={r.number} className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                  <div>
                    <dt className="text-text-muted text-xs">Registration Reference {i + 1}</dt>
                    <dd className="text-text-primary font-semibold font-mono tracking-tight break-all" data-testid={`society-reg-${i + 1}`}>{r.number}</dd>
                  </div>
                  <div>
                    <dt className="text-text-muted text-xs">Registration Date</dt>
                    <dd className="text-text-primary"><time dateTime={r.date}>{r.dateLabel}</time>, {r.place}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div>
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3"><Building2 className="w-4 h-4 text-brand-primary" aria-hidden="true" /> Registered Office</h4>
          <address className="not-italic text-sm text-text-primary leading-relaxed flex gap-2" data-testid="society-address" itemProp="address">
            <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-brand-secondary" aria-hidden="true" />
            <span>{SOCIETY.office.lines.map((l, i) => <React.Fragment key={l}>{l}{i < SOCIETY.office.lines.length - 1 ? ',' : '.'}<br /></React.Fragment>)}</span>
          </address>

          {!compact && <><h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-2 mt-5">Society contact</h4><SocietyContacts /></>}
        </div>
        {compact && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">Society contact</h4>
            <SocietyContacts />
            <p className="text-[11px] text-text-muted mt-4">For help with your LearnIQ account, exams or interviews, please use LearnIQ Support above.</p>
          </div>
        )}
      </div>
    </section>
  );
};

const SocietyContacts: React.FC = () => (
  <ul className="space-y-2 text-sm" data-testid="society-contacts">
    <li className="flex items-center gap-2 flex-wrap">
      <Phone className="w-4 h-4 text-accent-mint flex-shrink-0" aria-hidden="true" />
      <span className="text-text-muted text-xs">Telephone:</span>
      {SOCIETY.phones.map((p, i) => (
        <React.Fragment key={p}>
          <a href={telHref(p)} className="text-text-primary font-medium hover:text-brand-primary underline-offset-2 hover:underline" itemProp="telephone">{p}</a>
          {i < SOCIETY.phones.length - 1 && <span className="text-text-muted" aria-hidden="true">/</span>}
        </React.Fragment>
      ))}
    </li>
    <li className="flex items-center gap-2 flex-wrap">
      <Mail className="w-4 h-4 text-brand-primary flex-shrink-0" aria-hidden="true" />
      <span className="text-text-muted text-xs">Email:</span>
      <a href={`mailto:${SOCIETY.email}`} className="text-text-primary font-medium hover:text-brand-primary underline-offset-2 hover:underline break-all" itemProp="email">{SOCIETY.email}</a>
    </li>
  </ul>
);

export default SocietyDetails;
