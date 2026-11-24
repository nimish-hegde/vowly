import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  FileText,
  MinusCircle,
} from 'lucide-react';
import { VendorStatus } from '../types/vowly';

export function DemoDataNote({
  className = '',
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center text-[11px] font-medium text-[#6B655C] ${className}`}
      title="Fictional pricing and quotes created for demonstration purposes."
    >
      {compact ? 'Illustrative demo' : 'Illustrative demo data'}
    </span>
  );
}

export function StatusText({
  status,
  className = '',
}: {
  status: VendorStatus | string;
  className?: string;
}) {
  const config: Record<
    string,
    { color: string; icon?: React.ComponentType<{ className?: string }> }
  > = {
    Booked: { color: 'text-[#234733] font-semibold', icon: CheckCircle2 },
    Confirmed: { color: 'text-[#234733] font-semibold', icon: CheckCircle2 },
    Paid: { color: 'text-[#234733] font-semibold', icon: CheckCircle2 },
    Quoted: { color: 'text-[#214869] font-medium', icon: FileText },
    Estimated: { color: 'text-[#214869] font-medium', icon: FileText },
    Shortlisted: { color: 'text-[#42306B] font-medium', icon: Circle },
    'In progress': { color: 'text-[#42306B] font-medium', icon: Clock },
    Shortlisting: { color: 'text-[#733B20] font-medium', icon: Clock },
    'Revision pending': { color: 'text-[#9A4A06] font-semibold', icon: AlertTriangle },
    Overdue: { color: 'text-[#991B1B] font-semibold', icon: AlertTriangle },
    'Due soon': { color: 'text-[#9A4A06] font-semibold', icon: AlertTriangle },
    Unpriced: { color: 'text-[#9A4A06] font-medium', icon: AlertTriangle },
    'No quote': { color: 'text-[#9A4A06] font-medium', icon: AlertTriangle },
    'Date TBD': { color: 'text-[#9A4A06] font-medium', icon: Clock },
    Researching: { color: 'text-[#6B655C] font-medium', icon: Circle },
    Planned: { color: 'text-[#6B655C] font-medium', icon: Circle },
    'Early planning': { color: 'text-[#6B655C] font-medium', icon: Circle },
    Upcoming: { color: 'text-[#214869] font-medium', icon: Clock },
    Declined: { color: 'text-[#7A7368] line-through', icon: MinusCircle },
  };

  const match = config[status] ?? { color: 'text-[#6B655C]' };
  const Icon = match.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${match.color} ${className}`}
    >
      {Icon && <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />}
      <span>{status}</span>
    </span>
  );
}
