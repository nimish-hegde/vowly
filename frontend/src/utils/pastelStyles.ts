import { PastelTone } from '../types/vowly';

export interface PastelThemeTokens {
  label: string;
  surfaceBg: string;
  surfaceHover: string;
  border: string;
  ink: string;
  barFill: string;
  dot: string;
  softTint: string;
  accentStrip: string;
}

export const PASTEL_TONES: Record<PastelTone, PastelThemeTokens> = {
  sage: {
    label: 'Sage',
    surfaceBg: 'bg-[#DFEFE4]',
    surfaceHover: 'hover:bg-[#D1E7D8]',
    border: 'border-[#B6D7C0]',
    ink: 'text-[#234733]',
    barFill: 'bg-[#5F8E72]',
    dot: 'bg-[#4E7B61]',
    softTint: 'bg-[#EAF5EE]',
    accentStrip: 'bg-[#7BA78D]',
  },
  lavender: {
    label: 'Lilac',
    surfaceBg: 'bg-[#EAE2F7]',
    surfaceHover: 'hover:bg-[#DED3F2]',
    border: 'border-[#CBBCE8]',
    ink: 'text-[#42306B]',
    barFill: 'bg-[#8670B3]',
    dot: 'bg-[#725BA0]',
    softTint: 'bg-[#F2ECFA]',
    accentStrip: 'bg-[#9984C4]',
  },
  blush: {
    label: 'Blush',
    surfaceBg: 'bg-[#F8E2E8]',
    surfaceHover: 'hover:bg-[#F3D3DC]',
    border: 'border-[#E9BECB]',
    ink: 'text-[#6F2D41]',
    barFill: 'bg-[#C47C91]',
    dot: 'bg-[#B1667C]',
    softTint: 'bg-[#FCF0F3]',
    accentStrip: 'bg-[#D18FA2]',
  },
  peach: {
    label: 'Peach',
    surfaceBg: 'bg-[#FCE5D7]',
    surfaceHover: 'hover:bg-[#F7D7C4]',
    border: 'border-[#ECC4AC]',
    ink: 'text-[#733B20]',
    barFill: 'bg-[#CC8764]',
    dot: 'bg-[#B87250]',
    softTint: 'bg-[#FDF1EA]',
    accentStrip: 'bg-[#D99B7C]',
  },
  blue: {
    label: 'Powder Blue',
    surfaceBg: 'bg-[#DCEBF8]',
    surfaceHover: 'hover:bg-[#CCE1F4]',
    border: 'border-[#B5D3EE]',
    ink: 'text-[#214869]',
    barFill: 'bg-[#6998C2]',
    dot: 'bg-[#5383AE]',
    softTint: 'bg-[#EAF3FB]',
    accentStrip: 'bg-[#7DA9CF]',
  },
};

export const ALL_PASTEL_TONES: PastelTone[] = [
  'sage',
  'lavender',
  'blush',
  'peach',
  'blue',
];
