import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AppShell } from './components/AppShell';
import { BookingModal } from './components/BookingModal';
import { BudgetView } from './components/BudgetView';
import { EventsView } from './components/EventsView';
import { OnboardingFlow } from './components/OnboardingFlow';
import { OverviewView } from './components/OverviewView';
import { PaymentsView } from './components/PaymentsView';
import {
  AddVendorModal,
  EventModal,
  ManualExpenseModal,
  PartnerModal,
  SettingsModal,
} from './components/QuickModals';
import { QuoteImportModal } from './components/QuoteImportModal';
import { VendorDetailDrawer } from './components/VendorDetailDrawer';
import { VendorsView } from './components/VendorsView';
import { useWorkspace, WorkspaceProvider } from './store/workspaceStore';
import { ManualExpense, WeddingEvent } from './types/vowly';

function VowlyAppContent() {
  const {
    activeNav,
    setActiveNav,
    showOnboarding,
    setShowOnboarding,
    selectedVendorId,
    setSelectedVendorId,
    setSelectedEventId,
  } = useWorkspace();

  const [vendorsMode, setVendorsMode] = useState<'directory' | 'compare'>('directory');
  const [compareEventId, setCompareEventId] = useState<string | undefined>(undefined);
  const [budgetSourceFilter, setBudgetSourceFilter] = useState<string | undefined>(
    undefined
  );

  // Quote Import & Review Modal state
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [quotePresetId, setQuotePresetId] = useState<string | undefined>(undefined);
  const [quoteTargetVendorId, setQuoteTargetVendorId] = useState<string | undefined>(undefined);
  const [resumeDraftVendorId, setResumeDraftVendorId] = useState<string | undefined>(undefined);
  const [editApprovedVendorId, setEditApprovedVendorId] = useState<string | undefined>(undefined);

  // Booking Modal state
  const [bookingVendorId, setBookingVendorId] = useState<string | null>(null);

  // Quick Action Modals
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<WeddingEvent | null>(null);

  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ManualExpense | null>(null);

  const [addVendorModalOpen, setAddVendorModalOpen] = useState(false);
  const [addVendorPreselectedEventId, setAddVendorPreselectedEventId] = useState<
    string | null
  >(null);

  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  const openQuoteImport = (presetId?: string, vendorId?: string) => {
    setResumeDraftVendorId(undefined);
    setEditApprovedVendorId(undefined);
    setQuotePresetId(presetId);
    setQuoteTargetVendorId(vendorId);
    setQuoteModalOpen(true);
  };

  const openResumeDraft = (vendorId: string) => {
    setQuotePresetId(undefined);
    setQuoteTargetVendorId(undefined);
    setEditApprovedVendorId(undefined);
    setResumeDraftVendorId(vendorId);
    setQuoteModalOpen(true);
  };

  const openEditApprovedQuote = (vendorId: string) => {
    setQuotePresetId(undefined);
    setQuoteTargetVendorId(undefined);
    setResumeDraftVendorId(undefined);
    setEditApprovedVendorId(vendorId);
    setQuoteModalOpen(true);
  };

  const openComparison = (eventId?: string) => {
    setCompareEventId(eventId);
    setVendorsMode('compare');
    setActiveNav('vendors');
  };

  const openEvent = (eventId: string) => {
    setSelectedEventId(eventId);
    setActiveNav('events');
  };

  const openUnpricedBudget = () => {
    setBudgetSourceFilter('Unpriced / TBD');
    setActiveNav('budget');
  };

  const openAddVendorGlobal = () => {
    setAddVendorPreselectedEventId(null);
    setAddVendorModalOpen(true);
  };

  const openAddVendorForEvent = (eventId: string) => {
    setAddVendorPreselectedEventId(eventId);
    setAddVendorModalOpen(true);
  };

  if (showOnboarding) {
    return <OnboardingFlow onCloseToWorkspace={() => setShowOnboarding(false)} />;
  }

  return (
    <>
      <AppShell
        onOpenQuoteImport={() => openQuoteImport()}
        onOpenAddExpense={() => {
          setEditingExpense(null);
          setExpenseModalOpen(true);
        }}
        onOpenAddVendor={openAddVendorGlobal}
        onOpenCreateEvent={() => {
          setEditingEvent(null);
          setEventModalOpen(true);
        }}
        onOpenPartnerModal={() => setPartnerModalOpen(true)}
        onOpenSettingsModal={() => setSettingsModalOpen(true)}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={activeNav}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            {activeNav === 'overview' && (
              <OverviewView
                onOpenQuoteImport={openQuoteImport}
                onOpenEvent={openEvent}
                onOpenVendor={(id) => setSelectedVendorId(id)}
                onOpenUnpricedBudget={openUnpricedBudget}
              />
            )}

            {activeNav === 'events' && (
              <EventsView
                onCreateEvent={() => {
                  setEditingEvent(null);
                  setEventModalOpen(true);
                }}
                onEditEvent={(evt) => {
                  setEditingEvent(evt);
                  setEventModalOpen(true);
                }}
                onAddVendorForEvent={openAddVendorForEvent}
                onOpenVendor={(id) => setSelectedVendorId(id)}
                onOpenQuoteImport={openQuoteImport}
                onOpenComparison={openComparison}
              />
            )}

            {activeNav === 'budget' && (
              <BudgetView
                initialSourceFilter={budgetSourceFilter}
                onClearInitialSourceFilter={() => setBudgetSourceFilter(undefined)}
                onAddExpense={() => {
                  setEditingExpense(null);
                  setExpenseModalOpen(true);
                }}
                onEditExpense={(exp) => {
                  setEditingExpense(exp);
                  setExpenseModalOpen(true);
                }}
                onOpenVendor={(id) => setSelectedVendorId(id)}
              />
            )}

            {activeNav === 'vendors' && (
              <VendorsView
                initialMode={vendorsMode}
                initialCompareEventId={compareEventId}
                onEditApprovedQuote={openEditApprovedQuote}
                onAddVendor={openAddVendorGlobal}
                onOpenVendor={(id) => setSelectedVendorId(id)}
                onOpenQuoteImport={openQuoteImport}
                onOpenBooking={(id) => setBookingVendorId(id)}
              />
            )}

            {activeNav === 'payments' && (
              <PaymentsView
                onOpenVendor={(id) => setSelectedVendorId(id)}
                onOpenBookingFromVendors={() => {
                  setVendorsMode('directory');
                  setActiveNav('vendors');
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </AppShell>

      {/* Slide-Over Vendor Detail Drawer */}
      <VendorDetailDrawer
        vendorId={selectedVendorId}
        onClose={() => setSelectedVendorId(null)}
        onOpenQuoteImport={(presetId, vendorId) => {
          openQuoteImport(presetId, vendorId);
        }}
        onResumeDraft={(vendorId) => {
          openResumeDraft(vendorId);
        }}
        onEditApprovedQuote={(vendorId) => {
          openEditApprovedQuote(vendorId);
        }}
        onOpenBooking={(vendorId) => setBookingVendorId(vendorId)}
      />

      {/* Signature AI Quote Import & Split-Screen Review Modal */}
      <QuoteImportModal
        isOpen={quoteModalOpen}
        onClose={() => setQuoteModalOpen(false)}
        initialPresetId={quotePresetId}
        initialVendorId={quoteTargetVendorId}
        resumeDraftForVendorId={resumeDraftVendorId}
        editApprovedForVendorId={editApprovedVendorId}
      />

      {/* Explicit Booking Confirmation Modal */}
      <BookingModal
        vendorId={bookingVendorId}
        onClose={() => setBookingVendorId(null)}
      />

      {/* Quick Action & Collaboration Modals */}
      <EventModal
        isOpen={eventModalOpen}
        editingEvent={editingEvent}
        onClose={() => setEventModalOpen(false)}
      />

      <ManualExpenseModal
        isOpen={expenseModalOpen}
        editingExpense={editingExpense}
        onClose={() => setExpenseModalOpen(false)}
      />

      <AddVendorModal
        isOpen={addVendorModalOpen}
        preselectedEventId={addVendorPreselectedEventId}
        onClose={() => setAddVendorModalOpen(false)}
        onViewVendor={(vendorId) => setSelectedVendorId(vendorId)}
      />

      <PartnerModal
        isOpen={partnerModalOpen}
        onClose={() => setPartnerModalOpen(false)}
      />

      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
      />
    </>
  );
}

export default function App() {
  return (
    <WorkspaceProvider>
      <VowlyAppContent />
    </WorkspaceProvider>
  );
}
