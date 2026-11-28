import React from 'react';
import { AlertTriangle, FileText, LockKeyhole } from 'lucide-react';
import { formatCurrency } from '../engine/financialCalculator';
import type { buildQuoteRevisionPreview } from '../engine/revisionPreview';
import type { RevisionChange, RevisionDecision } from '../types/vowly';

type RevisionPreview = NonNullable<ReturnType<typeof buildQuoteRevisionPreview>>;

interface QuoteRevisionReviewProps {
  vendorName: string;
  preview: RevisionPreview;
  decisions?: Readonly<Record<string, RevisionDecision>>;
  note?: string;
  onDecision: (changeId: string, decision?: RevisionDecision) => void;
  onNoteChange: (note: string) => void;
  onRefresh?: () => void;
  restartManual: boolean;
  isBooked: boolean;
  additionalBlockers: string[];
}

const STATUS_LABELS: Record<RevisionChange['kind'], string> = {
  added: 'Added',
  changed: 'Changed',
  removed: 'Removed',
  carried: 'Carried forward',
  ambiguous: 'Needs a decision',
};

function formatChange(value: number | null, currency: string): string {
  if (value === null) return 'TBD';
  if (value === 0) return 'No change';
  return formatCurrency(Math.abs(value), currency, { decimals: 2 }) + (value < 0 ? ' less' : ' more');
}

function RevisionValue({
  heading,
  value,
  evidence,
}: {
  heading: string;
  value: string | null;
  evidence?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-[#FAF8F4] p-2.5 [overflow-wrap:anywhere]">
      <h5 className="text-[11px] font-semibold text-[#5A544C]">{heading}</h5>
      <p className="mt-0.5 whitespace-pre-line text-sm font-medium text-[#22201D]">{value ?? 'Not stated'}</p>
      {evidence && (
        <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-[#5A544C]">
          <span className="block text-[11px]">Source wording</span>
          <q>{evidence}</q>
        </p>
      )}
    </div>
  );
}

function RevisionChangeCard({
  change,
  decision,
  onDecision,
}: {
  change: RevisionChange;
  decision?: RevisionDecision;
  onDecision: (decision?: RevisionDecision) => void;
}) {
  const field = change.scope ? change.field + ' (' + change.scope + ')' : change.field;
  const needsDecision = change.needsDecision ?? change.kind === 'ambiguous';
  const candidates = change.candidates ?? [];
  const status = needsDecision ? 'Needs a decision' : change.kind === 'ambiguous' ? 'Resolved' : STATUS_LABELS[change.kind];
  const canRetain = change.previous !== null || change.kind === 'added' || needsDecision || decision?.action === 'retain';
  const canAccept = change.canAccept ?? true;
  const canChoose = canRetain || canAccept || change.canRemove || change.canEditAmount || candidates.length > 0;
  const replacement = decision?.action === 'replace' ? decision.targetId : undefined;
  const selection = decision?.action === 'replace' ? 'replace:' + decision.targetId : decision?.action ?? '';

  return (
    <li className="min-w-0 rounded-xl border border-[#E5DED2] bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-1.5">
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <h4 className="text-sm font-semibold text-[#22201D]">{change.field}</h4>
          {change.scope && <p className="text-[11px] text-[#6B655C]">{change.scope}</p>}
        </div>
        <span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold '
          + (needsDecision ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#F3EFE8] text-[#5A544C]')}>
          {status}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <RevisionValue heading="Previous approved" value={change.previous} evidence={change.previousEvidence} />
        <RevisionValue heading={decision ? 'Reviewed proposal' : 'Proposed revision'} value={change.proposed} evidence={change.proposedEvidence} />
      </div>
      {candidates.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-semibold text-[#486755] underline underline-offset-2">
            Possible matches in previous quote
          </summary>
          <ul className="mt-1 space-y-1 text-[#5A544C]">
            {candidates.map((candidate) => (
              <li key={candidate.id} className="min-w-0 [overflow-wrap:anywhere]">
                <strong>{candidate.label}</strong> · {candidate.value}
                {candidate.evidence && <p><q>{candidate.evidence}</q></p>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {canChoose && (
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          <label className="min-w-0 space-y-1 text-xs font-medium text-[#5A544C]">
            <span>Resolution</span>
            <select
              aria-label={'Resolution for ' + field}
              value={selection}
              onChange={(event) => {
                const action = event.target.value;
                if (action.startsWith('replace:')) {
                  onDecision({ action: 'replace', targetId: action.slice('replace:'.length) });
                } else if (action === 'manual') {
                  onDecision({ action, value: '' });
                } else if (action === 'accept' || action === 'retain' || action === 'remove') {
                  onDecision({ action });
                } else {
                  onDecision();
                }
              }}
              className="min-h-9 w-full min-w-0 rounded-lg border border-[#D7CDC0] bg-white px-2 py-1.5 text-xs text-[#22201D]"
            >
              <option value="">{needsDecision ? 'Choose a resolution' : 'Use suggested result'}</option>
              {canRetain && <option value="retain">{change.previous === null ? 'Ignore proposed change' : 'Retain previous value'}</option>}
              {canAccept && (
                <option value="accept">
                  {needsDecision && change.previous === null ? (change.scope === 'Package' ? 'Add as another package' : 'Accept as an additional charge') : 'Accept proposed value'}
                </option>
              )}
              {candidates.map((candidate) => <option key={candidate.id} value={'replace:' + candidate.id}>Replace {candidate.label} ({candidate.value})</option>)}
              {replacement && !candidates.some((candidate) => candidate.id === replacement) && (
                <option value={'replace:' + replacement}>Replace previous value</option>
              )}
              {change.canEditAmount && <option value="manual">Enter a confirmed amount</option>}
              {change.canRemove && <option value="remove">Confirm removal</option>}
            </select>
          </label>
          {decision?.action === 'manual' && (
            <label className="min-w-0 space-y-1 text-xs font-medium text-[#5A544C]">
              <span>Confirmed amount</span>
              <input
                aria-label={'Confirmed amount for ' + field}
                type="text"
                inputMode="decimal"
                value={decision.value}
                placeholder="300.00"
                onChange={(event) => onDecision({ action: 'manual', value: event.target.value })}
                className="min-h-9 w-full rounded-lg border border-[#D7CDC0] bg-white px-2 py-1.5 text-xs text-[#22201D]"
              />
            </label>
          )}
        </div>
      )}
    </li>
  );
}

export function QuoteRevisionReview({
  vendorName,
  preview,
  decisions,
  note,
  onDecision,
  onNoteChange,
  onRefresh,
  restartManual,
  isBooked,
  additionalBlockers,
}: QuoteRevisionReviewProps) {
  const { previousCalc, proposedCalc, bookedContractTotal } = preview;
  const currency = proposedCalc.currencyLabel;
  const financialRows = [
    { label: 'Pre-tax', previous: previousCalc.preTaxTotal, proposed: proposedCalc.preTaxTotal, delta: preview.preTaxDelta },
    {
      label: 'All-in',
      previous: previousCalc.isEstimateComplete ? previousCalc.estimatedAllInTotal : null,
      proposed: proposedCalc.isEstimateComplete ? proposedCalc.estimatedAllInTotal : null,
      delta: preview.allInDelta,
    },
  ];
  const blockers = preview.duplicate ? [] : Array.from(new Set([...preview.blockingReasons, ...additionalBlockers]));

  return (
    <section aria-label="Revision review" className="min-w-0 space-y-4 rounded-2xl border border-[#B6D7C0] bg-[#F5FAF6] p-3.5 sm:p-4">
      <div>
        <h3 className="text-base font-semibold text-[#1F3A2B]">Revision review</h3>
        <p className="mt-0.5 text-xs text-[#5A544C]">{vendorName}</p>
      </div>

      {preview.stale && !preview.duplicate && onRefresh && (
        <div className="space-y-2 rounded-lg border border-[#F59E0B]/60 bg-[#FFFBEB] p-2.5 text-xs text-[#92400E]">
          <p>{restartManual
            ? 'Restart from the latest approved quote to replace these stale edits.'
            : 'Review this draft against the latest approved quote. Previous review choices will reset.'}</p>
          <button type="button" onClick={onRefresh} className="rounded-md border border-[#D49A49] bg-white px-2.5 py-1.5 font-semibold">
            {restartManual ? 'Restart from latest approved quote' : 'Use latest approved quote'}
          </button>
        </div>
      )}

      {!preview.stale && (
        <div className="min-w-0 rounded-xl border border-[#D8E7DB] bg-white p-2.5 sm:p-3">
          <table aria-label="Revision financial impact" className="w-full table-fixed text-left text-xs [overflow-wrap:anywhere]">
            <thead className="text-[#5A544C]">
              <tr>
                <th scope="col" className="w-[18%] pb-1.5">Impact</th>
                <th scope="col" className="px-1 pb-1.5">Previous</th>
                <th scope="col" className="px-1 pb-1.5">Proposed</th>
                <th scope="col" className="pl-1 pb-1.5">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EAE0] text-[#22201D]">
              {financialRows.map(({ label, previous, proposed, delta }) => (
                <tr key={label} className="align-top">
                  <th scope="row" className="py-1.5 pr-1 font-medium">{label}</th>
                  <td className="px-1 py-1.5 font-num">{previous === null ? 'Incomplete' : formatCurrency(previous, previousCalc.currencyLabel, { decimals: 2 })}</td>
                  <td className="px-1 py-1.5 font-num">{preview.currencyConflict ? 'Unavailable' : proposed === null ? 'Incomplete' : formatCurrency(proposed, currency, { decimals: 2 })}</td>
                  <td className="pl-1 py-1.5 font-semibold">{formatChange(delta, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(!previousCalc.isEstimateComplete || !proposedCalc.isEstimateComplete) && (
            <p className="mt-1 text-[11px] text-[#92400E]">A partial estimate reflects only known amounts.</p>
          )}
          <p className="mt-2 border-t border-[#F0EAE0] pt-2 text-xs text-[#22201D]">
            Projected budget impact <strong className="ml-1">{formatChange(preview.projectedDelta, currency)}</strong>
          </p>
        </div>
      )}

      {isBooked && (
        <div className="flex items-start gap-2 rounded-lg border border-[#E5DED2] bg-[#F3EFE8] p-2.5 text-xs text-[#5A544C]">
          <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold text-[#22201D]">Confirmed contract locked</p>
            {bookedContractTotal !== undefined && (
              <p>{formatCurrency(bookedContractTotal, previousCalc.currencyLabel, { decimals: 2 })}</p>
            )}
            <p>Existing payments and milestones are preserved.</p>
          </div>
        </div>
      )}

      {blockers.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-[#F59E0B]/60 bg-[#FFFBEB] p-2.5 text-xs text-[#92400E]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <h4 className="font-semibold">Resolve before approving</h4>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">{blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div>
        </div>
      )}

      {preview.duplicate && (
        <p className="flex items-start gap-2 text-xs text-[#5A544C]">
          <FileText className="size-4 shrink-0" aria-hidden="true" />
          This revision has already been reviewed and will leave the approved quote as is.
        </p>
      )}

      {!preview.stale && (
        <>
          {preview.changes.length > 0 && (
            <ul aria-label="Proposed quote changes" className="space-y-2">
              {preview.changes.map((change) => (
                <RevisionChangeCard
                  key={change.id}
                  change={change}
                  decision={decisions?.[change.id]}
                  onDecision={(decision) => onDecision(change.id, decision)}
                />
              ))}
            </ul>
          )}
          <label className="block space-y-1 text-xs font-medium text-[#5A544C]">
            <span>Revision note (optional)</span>
            <input
              type="text"
              value={note ?? ''}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder="e.g. Confirmed updated AV rate with vendor"
              className="min-h-9 w-full rounded-lg border border-[#D7CDC0] bg-white px-2 py-1.5 text-xs text-[#22201D]"
            />
          </label>
        </>
      )}
    </section>
  );
}
