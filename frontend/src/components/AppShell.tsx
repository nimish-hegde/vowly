import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  CalendarDays,
  ChevronDown,
  CreditCard,
  FileSpreadsheet,
  FileUp,
  LayoutDashboard,
  Plus,
  PlusCircle,
  Receipt,
  RotateCcw,
  Settings,
  UserPlus,
  X,
} from 'lucide-react';
import { useWorkspace } from '../store/workspaceStore';
import { NavSection } from '../types/vowly';
import { PASTEL_TONES } from '../utils/pastelStyles';

interface AppShellProps {
  children: React.ReactNode;
  onOpenQuoteImport: () => void;
  onOpenAddExpense: () => void;
  onOpenAddVendor: () => void;
  onOpenCreateEvent: () => void;
  onOpenPartnerModal: () => void;
  onOpenSettingsModal: () => void;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'events', label: 'Events', icon: CalendarDays },
  { id: 'budget', label: 'Budget', icon: FileSpreadsheet },
  { id: 'vendors', label: 'Vendors', icon: Building2 },
  { id: 'payments', label: 'Payments', icon: CreditCard },
];

export function AppShell({
  children,
  onOpenQuoteImport,
  onOpenAddExpense,
  onOpenAddVendor,
  onOpenCreateEvent,
  onOpenPartnerModal,
  onOpenSettingsModal,
}: AppShellProps) {
  const {
    workspaces,
    activeWorkspace,
    activeNav,
    setActiveNav,
    switchWorkspace,
    setShowOnboarding,
    resetDemoWorkspace,
    toasts,
    dismissToast,
  } = useWorkspace();

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
      if (wsRef.current && !wsRef.current.contains(e.target as Node)) {
        setWsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const primaryPartner = activeWorkspace.partners[0];

  return (
    <div className="min-h-screen bg-[#FAF8F4] text-[#22201D] flex">
      {/* PERSISTENT DESKTOP SIDEBAR (256px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-[#F4F0E8] border-r border-[#E5DED2] px-4 py-5 justify-between z-20">
        <div className="space-y-5">
          {/* Brand Wordmark */}
          <div className="px-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setActiveNav('overview')}
              className="font-editorial text-2xl font-semibold tracking-tight text-[#22201D] cursor-pointer"
            >
              Vowly
            </button>
          </div>

          {/* Workspace Selector */}
          <div className="relative" ref={wsRef}>
            <button
              type="button"
              onClick={() => setWsMenuOpen((o) => !o)}
              className="w-full rounded-xl bg-white border border-[#E5DED2] px-3 py-2.5 text-left flex items-center justify-between gap-2 hover:border-[#C6DEC9] transition-colors cursor-pointer"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#22201D] truncate">
                  {activeWorkspace.coupleNames}
                </div>
                <div className="text-[11px] text-[#6B655C] truncate">
                  {activeWorkspace.isDemoWorkspace
                    ? 'GTA Demo · Illustrative data'
                    : activeWorkspace.location}
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-[#6B655C] shrink-0" />
            </button>

            {wsMenuOpen && (
              <div className="absolute left-0 right-0 mt-1.5 rounded-xl bg-white border border-[#E5DED2] shadow-lg py-1.5 z-30">
                <div className="px-3 py-1 text-[11px] font-semibold text-[#6B655C]">
                  Wedding workspaces
                </div>
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    type="button"
                    onClick={() => {
                      switchWorkspace(ws.id);
                      setWsMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-[#FAF8F4] flex items-center justify-between cursor-pointer ${
                      ws.id === activeWorkspace.id
                        ? 'font-semibold text-[#2D4F3C] bg-[#F3F8F5]'
                        : 'text-[#22201D]'
                    }`}
                  >
                    <span className="truncate">{ws.coupleNames}</span>
                    {ws.isDemoWorkspace && (
                      <span className="text-[10px] text-[#6B655C] shrink-0 ml-2">
                        Demo
                      </span>
                    )}
                  </button>
                ))}
                <div className="my-1 border-t border-[#F0EAE0]" />
                <button
                  type="button"
                  onClick={() => {
                    setWsMenuOpen(false);
                    setShowOnboarding(true);
                  }}
                  className="w-full text-left px-3 py-2 text-xs font-medium text-[#4C3B70] hover:bg-[#F7F4FC] flex items-center gap-2 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  New Workspace / Onboarding
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWsMenuOpen(false);
                    resetDemoWorkspace();
                  }}
                  className="w-full text-left px-3 py-2 text-xs font-medium text-[#7A4329] hover:bg-[#FDF6F2] flex items-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Demo Data
                </button>
              </div>
            )}
          </div>

          {/* Prominent + Add Action */}
          <div className="relative" ref={addRef}>
            <button
              type="button"
              onClick={() => setAddMenuOpen((o) => !o)}
              className="w-full py-2.5 px-4 rounded-xl bg-[#486755] text-white hover:bg-[#395344] transition-colors text-sm font-medium flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>

            {addMenuOpen && (
              <div className="absolute left-0 right-0 mt-1.5 rounded-xl bg-white border border-[#E5DED2] shadow-lg py-1.5 z-30">
                <button
                  type="button"
                  onClick={() => {
                    setAddMenuOpen(false);
                    onOpenQuoteImport();
                  }}
                  className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-[#22201D] hover:bg-[#E7F1EA] flex items-center gap-2.5 cursor-pointer"
                >
                  <FileUp className="w-4 h-4 text-[#486755]" />
                  <div>
                    <div>Import vendor quote</div>
                    <div className="text-[10px] text-[#6B655C] font-normal">
                      Paste message, PDF, or screenshot
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddMenuOpen(false);
                    onOpenAddExpense();
                  }}
                  className="w-full text-left px-3.5 py-2 text-xs font-medium text-[#22201D] hover:bg-[#FAF8F4] flex items-center gap-2.5 cursor-pointer"
                >
                  <Receipt className="w-4 h-4 text-[#4C3B70]" />
                  Add manual expense
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddMenuOpen(false);
                    onOpenAddVendor();
                  }}
                  className="w-full text-left px-3.5 py-2 text-xs font-medium text-[#22201D] hover:bg-[#FAF8F4] flex items-center gap-2.5 cursor-pointer"
                >
                  <Building2 className="w-4 h-4 text-[#7A4329]" />
                  Add vendor
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddMenuOpen(false);
                    onOpenCreateEvent();
                  }}
                  className="w-full text-left px-3.5 py-2 text-xs font-medium text-[#22201D] hover:bg-[#FAF8F4] flex items-center gap-2.5 cursor-pointer"
                >
                  <CalendarDays className="w-4 h-4 text-[#2B5170]" />
                  Create event
                </button>
              </div>
            )}
          </div>

          {/* Primary Navigation */}
          <nav aria-label="Main navigation" className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-[#E7F1EA] text-[#1F3A2B] font-semibold'
                      : 'text-[#5A544C] hover:bg-white/70 hover:text-[#22201D] font-medium'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-[#486755]' : 'text-[#7C756B]'
                    }`}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Secondary Sidebar Controls */}
        <div className="pt-4 border-t border-[#E5DED2] space-y-1">
          <button
            type="button"
            onClick={onOpenPartnerModal}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-[#5A544C] hover:bg-white/70 hover:text-[#22201D] cursor-pointer"
          >
            <UserPlus className="w-4 h-4 text-[#7C756B]" />
            Partner collaboration
          </button>
          <button
            type="button"
            onClick={onOpenSettingsModal}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-[#5A544C] hover:bg-white/70 hover:text-[#22201D] cursor-pointer"
          >
            <Settings className="w-4 h-4 text-[#7C756B]" />
            Settings & Reset Demo
          </button>

          {/* Profile */}
          {primaryPartner && (
            <button
              type="button"
              onClick={onOpenPartnerModal}
              className="mt-2 w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-white/80 border border-[#E5DED2] hover:bg-white transition-colors text-left cursor-pointer"
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${
                  PASTEL_TONES[primaryPartner.tone].surfaceBg
                } ${PASTEL_TONES[primaryPartner.tone].ink}`}
              >
                {primaryPartner.initials}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#22201D] truncate">
                  {primaryPartner.name}
                </div>
                <div className="text-[10px] text-[#6B655C] truncate">
                  {activeWorkspace.partners.length} partners active
                </div>
              </div>
            </button>
          )}
        </div>
      </aside>

      {/* MAIN VIEWPORT */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Compact Mobile Header (keeps sticky chrome well under 15% mobile height) */}
        <header className="lg:hidden sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-[#E5DED2] px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setActiveNav('overview')}
              className="font-editorial text-lg font-semibold text-[#22201D] whitespace-nowrap shrink-0"
            >
              Vowly
            </button>
            <span className="text-[#D8D0C3]">·</span>
            <button
              type="button"
              onClick={onOpenSettingsModal}
              className="text-xs font-medium text-[#6B655C] truncate"
            >
              {activeWorkspace.coupleNames}
            </button>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowOnboarding(true)}
              className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-[#E5DED2] text-[#6B655C] whitespace-nowrap"
            >
              New
            </button>
            <button
              type="button"
              onClick={onOpenQuoteImport}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#486755] text-white whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Import
            </button>
          </div>
        </header>

        {/* Main Content Container */}
        <main className="flex-1 w-full max-w-[1220px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 pb-24 lg:pb-12">
          {children}
        </main>

        {/* Compact Mobile Bottom Navigation Bar */}
        <nav
          aria-label="Mobile navigation"
          className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-white/95 backdrop-blur-xs border-t border-[#E5DED2] px-2 py-1.5 grid grid-cols-5 gap-1"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                className={`flex flex-col items-center justify-center py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
                  isActive
                    ? 'bg-[#E7F1EA] text-[#1F3A2B] font-semibold'
                    : 'text-[#6B655C]'
                }`}
              >
                <Icon className="w-4 h-4 mb-0.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Subtle Toast Notifications */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-20 lg:bottom-6 right-4 sm:right-6 z-50 space-y-2 max-w-sm"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`rounded-xl border px-4 py-2.5 shadow-md flex items-center justify-between gap-3 text-xs font-medium ${
                t.tone === 'amber'
                  ? 'bg-[#FEF3C7] border-[#F59E0B]/50 text-[#92400E]'
                  : t.tone === 'neutral'
                    ? 'bg-white border-[#E5DED2] text-[#22201D]'
                    : 'bg-[#DFF0E4] border-[#B0D2B8] text-[#1F402E]'
              }`}
            >
              <span className="min-w-0">{t.text}</span>
              <div className="flex items-center gap-2 shrink-0">
                {t.actionLabel && t.onAction && (
                  <button
                    type="button"
                    onClick={() => {
                      t.onAction?.();
                      dismissToast(t.id);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-white/90 border border-current/25 text-[11px] font-semibold hover:bg-white cursor-pointer whitespace-nowrap"
                  >
                    {t.actionLabel}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismissToast(t.id)}
                  className="opacity-70 hover:opacity-100 cursor-pointer p-0.5"
                  aria-label="Dismiss notification"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
