import React, { useEffect, useState } from 'react';
import { Mail, RotateCcw, UserPlus, X } from 'lucide-react';
import { CATEGORY_META } from '../engine/financialCalculator';
import { useWorkspace } from '../store/workspaceStore';
import {
  EventPlanningStatus,
  ManualExpense,
  PastelTone,
  PriceSource,
  Vendor,
  VendorCategory,
  VendorStatus,
  WeddingEvent,
} from '../types/vowly';
import { ALL_PASTEL_TONES, PASTEL_TONES } from '../utils/pastelStyles';

/* ---------------- EVENT CREATE / EDIT MODAL ---------------- */
export function EventModal({
  isOpen,
  editingEvent,
  onClose,
}: {
  isOpen: boolean;
  editingEvent: WeddingEvent | null;
  onClose: () => void;
}) {
  const { upsertEvent } = useWorkspace();

  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [guestCount, setGuestCount] = useState('');
  const [status, setStatus] = useState<EventPlanningStatus>('In progress');
  const [budgetStr, setBudgetStr] = useState('');
  const [tone, setTone] = useState<PastelTone>('sage');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    if (editingEvent) {
      setName(editingEvent.name);
      setDate(editingEvent.date);
      setTime(editingEvent.time);
      setLocation(editingEvent.location);
      setGuestCount(
        editingEvent.guestCount !== null ? String(editingEvent.guestCount) : ''
      );
      setStatus(editingEvent.status);
      setBudgetStr(
        editingEvent.budgetAllowance !== null
          ? String(editingEvent.budgetAllowance)
          : ''
      );
      setTone(editingEvent.tone);
      setNotes(editingEvent.notes ?? '');
    } else {
      setName('');
      setDate('');
      setTime('');
      setLocation('');
      setGuestCount('');
      setStatus('Early planning');
      setBudgetStr('');
      setTone('lavender');
      setNotes('');
    }
  }, [isOpen, editingEvent]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const formattedDate = date
      ? new Date(`${date}T12:00:00`).toLocaleDateString('en-CA', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : 'Date TBD';

    const trimmedGuests = guestCount.trim();
    const parsedGuests =
      trimmedGuests !== '' && /^\d+$/.test(trimmedGuests)
        ? Math.max(1, parseInt(trimmedGuests, 10))
        : null;

    upsertEvent({
      id: editingEvent?.id ?? `evt-${Date.now()}`,
      name: name.trim(),
      date,
      dateDisplay: formattedDate,
      time: time.trim(),
      location: location.trim() || 'Location TBD',
      guestCount: parsedGuests,
      status,
      budgetAllowance:
        budgetStr.trim() !== '' && !Number.isNaN(parseFloat(budgetStr))
          ? parseFloat(budgetStr)
          : null,
      tone,
      notes: notes.trim() || undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white border border-[#E5DED2] rounded-2xl w-full max-w-lg overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-[#E5DED2] flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#22201D]">
            {editingEvent ? `Edit ${editingEvent.name}` : 'Create Event'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#6B655C] hover:bg-[#F3EFE8] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div>
            <label className="block font-medium text-[#22201D] mb-1">
              Event name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Sangeet / Jaggo, Choora, Reception"
              className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Date (optional)
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Time window
              </label>
              <input
                type="text"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="e.g., 6:00 PM – 11:30 PM"
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Planned guest count (optional)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={guestCount}
                onChange={(e) => setGuestCount(e.target.value)}
                placeholder="Leave blank if TBD"
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 font-num text-sm placeholder:font-sans placeholder:text-[#9A9388]"
              />
            </div>
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Event budget target (optional)
              </label>
              <input
                type="number"
                value={budgetStr}
                onChange={(e) => setBudgetStr(e.target.value)}
                placeholder="Leave blank if TBD"
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 font-num text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Location
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Venue or city"
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Planning status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as EventPlanningStatus)}
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
              >
                <option value="Confirmed">Confirmed</option>
                <option value="In progress">In progress</option>
                <option value="Shortlisting">Shortlisting</option>
                <option value="Early planning">Early planning</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-medium text-[#22201D] mb-1.5">
              Card color accent
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {ALL_PASTEL_TONES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTone(t)}
                  className={`px-3 py-1.5 rounded-lg border cursor-pointer ${
                    PASTEL_TONES[t].surfaceBg
                  } ${
                    tone === t
                      ? 'border-[#22201D] font-semibold'
                      : PASTEL_TONES[t].border
                  } ${PASTEL_TONES[t].ink}`}
                >
                  {PASTEL_TONES[t].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-medium text-[#22201D] mb-1">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[#E5DED2] text-[#6B655C] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#486755] text-white font-semibold hover:bg-[#395344] cursor-pointer"
            >
              {editingEvent ? 'Save Event' : 'Create Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- MANUAL EXPENSE MODAL ---------------- */
export function ManualExpenseModal({
  isOpen,
  editingExpense,
  onClose,
}: {
  isOpen: boolean;
  editingExpense: ManualExpense | null;
  onClose: () => void;
}) {
  const { activeWorkspace, upsertManualExpense } = useWorkspace();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<VendorCategory>('other');
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [allowanceStr, setAllowanceStr] = useState('');
  const [priceSource, setPriceSource] = useState<PriceSource>('User-entered allowance');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    if (editingExpense) {
      setName(editingExpense.name);
      setCategory(editingExpense.category);
      setEventIds(editingExpense.eventIds);
      setAllowanceStr(
        editingExpense.estimatedAmount !== null
          ? String(editingExpense.estimatedAmount)
          : ''
      );
      setPriceSource(editingExpense.priceSource);
      setNotes(editingExpense.notes ?? '');
    } else {
      setName('');
      setCategory('other');
      setEventIds(activeWorkspace.events[0] ? [activeWorkspace.events[0].id] : []);
      setAllowanceStr('');
      setPriceSource('User-entered allowance');
      setNotes('');
    }
  }, [isOpen, editingExpense]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const isUnpriced = priceSource === 'Unpriced / TBD' || allowanceStr.trim() === '';
    const amount = isUnpriced ? null : parseFloat(allowanceStr) || null;

    upsertManualExpense({
      id: editingExpense?.id ?? `exp-${Date.now()}`,
      name: name.trim(),
      category,
      eventIds,
      budgetAllowance: amount,
      estimatedAmount: amount,
      committedAmount: editingExpense?.committedAmount ?? 0,
      paidAmount: editingExpense?.paidAmount ?? 0,
      priceSource: amount === null ? 'Unpriced / TBD' : priceSource,
      status: amount === null ? 'Unpriced' : 'Estimated',
      notes: notes.trim() || undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white border border-[#E5DED2] rounded-2xl w-full max-w-lg overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-[#E5DED2] flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#22201D]">
            {editingExpense ? 'Edit Expense' : 'Add Manual Expense'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#6B655C] hover:bg-[#F3EFE8] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div>
            <label className="block font-medium text-[#22201D] mb-1">
              Expense name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Bridal Outfit & Tailoring, Wedding Invitations"
              className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as VendorCategory)}
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
              >
                {(Object.keys(CATEGORY_META) as VendorCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_META[cat].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Price source
              </label>
              <select
                value={priceSource}
                onChange={(e) => setPriceSource(e.target.value as PriceSource)}
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
              >
                <option value="User-entered allowance">User-entered allowance</option>
                <option value="Unpriced / TBD">Unpriced / TBD</option>
              </select>
            </div>
          </div>

          {priceSource !== 'Unpriced / TBD' && (
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Budget allowance ({activeWorkspace.currency}) — leave blank for Unpriced / TBD
              </label>
              <input
                type="number"
                value={allowanceStr}
                onChange={(e) => setAllowanceStr(e.target.value)}
                placeholder="e.g., 2500"
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 font-num text-sm"
              />
            </div>
          )}

          <div>
            <div className="font-medium text-[#22201D] mb-1.5">
              Events covered
            </div>
            <div className="flex flex-wrap gap-1.5">
              {activeWorkspace.events.map((evt) => {
                const checked = eventIds.includes(evt.id);
                return (
                  <button
                    key={evt.id}
                    type="button"
                    onClick={() =>
                      setEventIds((prev) =>
                        checked
                          ? prev.filter((id) => id !== evt.id)
                          : [...prev, evt.id]
                      )
                    }
                    className={`px-2.5 py-1 rounded-lg border cursor-pointer ${
                      checked
                        ? 'bg-[#E7F1EA] border-[#486755] text-[#2D4F3C] font-medium'
                        : 'bg-[#FAF8F4] border-[#E5DED2] text-[#6B655C]'
                    }`}
                  >
                    {evt.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block font-medium text-[#22201D] mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional context..."
              className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[#E5DED2] text-[#6B655C] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#486755] text-white font-semibold hover:bg-[#395344] cursor-pointer"
            >
              {editingExpense ? 'Save Changes' : 'Add Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- ADD VENDOR MODAL ---------------- */
export function AddVendorModal({
  isOpen,
  preselectedEventId,
  onClose,
  onViewVendor,
}: {
  isOpen: boolean;
  preselectedEventId?: string | null;
  onClose: () => void;
  onViewVendor?: (vendorId: string) => void;
}) {
  const { activeWorkspace, addVendor } = useWorkspace();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<VendorCategory>('venue');
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState<VendorStatus>('Shortlisted');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [wholeWedding, setWholeWedding] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setCategory('venue');
    setLocation('');
    setStatus('Shortlisted');
    setContactName('');
    setContactEmail('');
    setNotes('');
    if (
      preselectedEventId &&
      activeWorkspace.events.some((e) => e.id === preselectedEventId)
    ) {
      setEventIds([preselectedEventId]);
      setWholeWedding(false);
    } else {
      // Explicit event choice required when opened globally
      setEventIds([]);
      setWholeWedding(activeWorkspace.events.length === 0);
    }
  }, [isOpen, preselectedEventId, activeWorkspace.events]);

  if (!isOpen) return null;

  const hasExplicitEventChoice = wholeWedding || eventIds.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !hasExplicitEventChoice) return;
    const newVendor: Vendor = {
      id: `ven-${Date.now()}`,
      name: name.trim(),
      category,
      eventIds: wholeWedding ? [] : eventIds,
      location: location.trim() || activeWorkspace.location || 'Ontario, Canada',
      contactName: contactName.trim(),
      contactEmail: contactEmail.trim(),
      contactPhone: '',
      status,
      isPreferred: false,
      notes: notes.trim(),
      quotes: [],
    };
    addVendor(newVendor, onViewVendor);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white border border-[#E5DED2] rounded-2xl w-full max-w-lg overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-[#E5DED2] flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#22201D]">Add Vendor</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#6B655C] hover:bg-[#F3EFE8] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Vendor name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Lotus Floral Studio"
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as VendorCategory)}
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
              >
                {(Object.keys(CATEGORY_META) as VendorCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_META[cat].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Location
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Initial status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as VendorStatus)}
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
              >
                <option value="Researching">Researching</option>
                <option value="Shortlisted">Shortlisted</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Contact person (optional)
              </label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Email (optional)
              </label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-medium text-[#22201D]">
                Link to event(s) *
              </span>
              {!hasExplicitEventChoice && (
                <span className="text-[11px] font-medium text-[#9A3412]">
                  Choose at least one event or Whole wedding
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {activeWorkspace.events.map((evt) => {
                const checked = !wholeWedding && eventIds.includes(evt.id);
                const tone = PASTEL_TONES[evt.tone];
                return (
                  <button
                    key={evt.id}
                    type="button"
                    onClick={() => {
                      setWholeWedding(false);
                      setEventIds((prev) =>
                        checked
                          ? prev.filter((id) => id !== evt.id)
                          : [...prev, evt.id]
                      );
                    }}
                    className={`px-2.5 py-1 rounded-lg border cursor-pointer transition-colors ${
                      checked
                        ? `${tone.surfaceBg} ${tone.border} ${tone.ink} font-semibold`
                        : 'bg-[#FAF8F4] border-[#E5DED2] text-[#6B655C]'
                    }`}
                  >
                    {checked ? '✓ ' : ''}
                    {evt.name}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setWholeWedding((prev) => !prev);
                  setEventIds([]);
                }}
                className={`px-2.5 py-1 rounded-lg border cursor-pointer transition-colors ${
                  wholeWedding
                    ? 'bg-[#22201D] border-[#22201D] text-white font-semibold'
                    : 'bg-[#FAF8F4] border-[#E5DED2] text-[#6B655C]'
                }`}
              >
                {wholeWedding ? '✓ ' : ''}
                Whole wedding
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-[#6B655C]">
              Saved as unpriced (“No quote”) until you import a quote.
            </p>
          </div>

          <div>
            <label className="block font-medium text-[#22201D] mb-1">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Referral source, portfolio link, or questions..."
              className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[#E5DED2] text-[#6B655C] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !hasExplicitEventChoice}
              className={`px-5 py-2 rounded-xl font-semibold transition-colors ${
                name.trim() && hasExplicitEventChoice
                  ? 'bg-[#486755] text-white hover:bg-[#395344] cursor-pointer'
                  : 'bg-[#E5DED2] text-[#9A9388] cursor-not-allowed'
              }`}
            >
              Save Vendor
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- PARTNER COLLABORATION MODAL ---------------- */
export function PartnerModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { activeWorkspace, invitePartner } = useWorkspace();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  if (!isOpen) return null;

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    invitePartner(name, email);
    setName('');
    setEmail('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white border border-[#E5DED2] rounded-2xl w-full max-w-lg overflow-hidden shadow-xl">
        <div className="px-6 py-4 bg-[#EFEAF8] border-b border-[#D7CBEB] flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#382A55]">
              Couple Workspace Collaboration
            </h2>
            <p className="text-xs text-[#4C3B70] mt-0.5">
              Shared privately between partners — no guest or family role clutter
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#4C3B70] hover:bg-white/60 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
          {/* Active Members */}
          <div>
            <div className="font-semibold text-[#22201D] mb-2">
              Workspace members ({activeWorkspace.partners.length} of 2 partners)
            </div>
            <div className="divide-y divide-[#F0EAE0] border border-[#E5DED2] rounded-xl overflow-hidden">
              {activeWorkspace.partners.map((p) => (
                <div
                  key={p.id}
                  className="p-3.5 flex items-center justify-between bg-white"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-xs ${
                        PASTEL_TONES[p.tone].surfaceBg
                      } ${PASTEL_TONES[p.tone].ink}`}
                    >
                      {p.initials}
                    </div>
                    <div>
                      <div className="font-semibold text-[#22201D]">{p.name}</div>
                      <div className="text-[11px] text-[#6B655C]">
                        {p.email || 'Email not added'}
                      </div>
                    </div>
                  </div>
                  <span className="font-medium text-[#2D4F3C]">
                    {p.roleLabel} · {p.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Invite / Update Partner */}
          <form
            onSubmit={handleInvite}
            className="rounded-xl bg-[#FAF8F4] border border-[#E5DED2] p-4 space-y-3"
          >
            <div className="font-semibold text-[#22201D] inline-flex items-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5 text-[#486755]" />
              Send partner invitation
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Partner name"
                className="rounded-lg border border-[#E5DED2] bg-white px-3 py-2 text-xs"
              />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="partner@email.com"
                className="rounded-lg border border-[#E5DED2] bg-white px-3 py-2 text-xs"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#486755] text-white font-semibold hover:bg-[#395344] cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5" />
              Send Invitation
            </button>
          </form>

          {/* Shared Activity History */}
          <div>
            <div className="font-semibold text-[#22201D] mb-2">
              Recent shared activity
            </div>
            <div className="space-y-2 max-h-36 overflow-y-auto">
              {activeWorkspace.activities.slice(0, 4).map((act) => (
                <div key={act.id} className="text-xs text-[#6B655C]">
                  <span className="font-medium text-[#22201D]">{act.actorName}:</span>{' '}
                  {act.summary}{' '}
                  <span className="text-[#9A9388]">({act.timestampLabel})</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- WORKSPACE SETTINGS & RESET DEMO MODAL ---------------- */
export function SettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { activeWorkspace, updateWorkspaceMeta, resetDemoWorkspace } =
    useWorkspace();
  const [coupleNames, setCoupleNames] = useState(activeWorkspace.coupleNames);
  const [location, setLocation] = useState(activeWorkspace.location);
  const [dateRangeLabel, setDateRangeLabel] = useState(
    activeWorkspace.dateRangeLabel
  );
  const [budgetStr, setBudgetStr] = useState(
    activeWorkspace.budgetTarget !== null ? String(activeWorkspace.budgetTarget) : ''
  );

  useEffect(() => {
    if (!isOpen) return;
    setCoupleNames(activeWorkspace.coupleNames);
    setLocation(activeWorkspace.location);
    setDateRangeLabel(activeWorkspace.dateRangeLabel);
    setBudgetStr(
      activeWorkspace.budgetTarget !== null ? String(activeWorkspace.budgetTarget) : ''
    );
  }, [isOpen, activeWorkspace]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateWorkspaceMeta({
      coupleNames: coupleNames.trim() || activeWorkspace.coupleNames,
      location: location.trim() || activeWorkspace.location,
      dateRangeLabel: dateRangeLabel.trim() || 'Date TBD',
      budgetTarget:
        budgetStr.trim() !== '' && !Number.isNaN(parseFloat(budgetStr))
          ? parseFloat(budgetStr)
          : null,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white border border-[#E5DED2] rounded-2xl w-full max-w-lg overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-[#E5DED2] flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#22201D]">
            Workspace Settings & Data
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#6B655C] hover:bg-[#F3EFE8] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4 text-xs">
          <div>
            <label className="block font-medium text-[#22201D] mb-1">
              Couple names
            </label>
            <input
              type="text"
              value={coupleNames}
              onChange={(e) => setCoupleNames(e.target.value)}
              className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Location
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block font-medium text-[#22201D] mb-1">
                Wedding date range
              </label>
              <input
                type="text"
                value={dateRangeLabel}
                onChange={(e) => setDateRangeLabel(e.target.value)}
                className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-[#22201D] mb-1">
              Overall wedding budget target ({activeWorkspace.currency})
            </label>
            <input
              type="number"
              value={budgetStr}
              onChange={(e) => setBudgetStr(e.target.value)}
              className="w-full rounded-xl border border-[#E5DED2] px-3 py-2 font-num text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[#E5DED2] text-[#6B655C] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#486755] text-white font-semibold hover:bg-[#395344] cursor-pointer"
            >
              Save Settings
            </button>
          </div>
        </form>

        <div className="px-6 py-4 bg-[#FAF8F4] border-t border-[#E5DED2] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-[#6B655C]">
            Changes are saved automatically in your browser. Reset anytime to restore Meera & Kabir’s original GTA demo data.
          </div>
          <button
            type="button"
            onClick={() => {
              resetDemoWorkspace();
              onClose();
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#EED0BE] bg-[#FAE9DF] text-[#7A4329] hover:bg-[#F5DDD0] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Demo Data
          </button>
        </div>
      </div>
    </div>
  );
}
