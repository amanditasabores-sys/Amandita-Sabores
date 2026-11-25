import React from 'react';

export const OFFICIAL_LOGO_PATH = '/assets/logo-amandita-oficial.jpg';

interface AmanditaLogoProps {
  variant?: 'full' | 'icon' | 'badge' | 'hero';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  theme?: 'dark' | 'light' | 'colored';
  className?: string;
  showSlogan?: boolean;
}

/**
 * Official Brand Logo Component for Amandita Sabores
 * Strictly renders the official artwork from /assets/logo-amandita-oficial.jpg
 * Preserving:
 * - Central daisy flower
 * - Original Amandita typography & heart detail
 * - 'S A B O R E S' mark
 * - 'Feito com amor, servido com sabor.' slogan
 * - Original proportions and colors without cropping or AI redrawing.
 */
export const AmanditaLogo: React.FC<AmanditaLogoProps> = ({
  variant = 'full',
  size = 'md',
  theme = 'colored',
  className = '',
  showSlogan = true,
}) => {
  // Dimensions based on size
  const iconDimensions = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-14 h-14',
    xl: 'w-20 h-20',
  }[size];

  const fullDimensions = {
    sm: 'h-10 w-auto',
    md: 'h-14 w-auto',
    lg: 'h-24 w-auto',
    xl: 'h-36 w-auto',
  }[size];

  // In icon variant, render the official emblem cleanly framed without cropping
  if (variant === 'icon') {
    return (
      <div
        className={`inline-flex items-center justify-center shrink-0 rounded-xl overflow-hidden shadow-xs border p-0.5 transition-transform ${
          theme === 'light'
            ? 'bg-[#FAF7F2] border-[#E2E8F0]'
            : theme === 'dark'
            ? 'bg-[#FAF7F2] border-white/25'
            : 'bg-[#FAF7F2] border-[#E2E8F0]'
        } ${iconDimensions} ${className}`}
        title="Amandita Sabores - Feito com amor, servido com sabor."
      >
        <img
          src={OFFICIAL_LOGO_PATH}
          alt="Amandita Sabores"
          className="w-full h-full object-contain rounded-lg"
          loading="eager"
        />
      </div>
    );
  }

  // Hero variant: Large featured emblem (perfect for customer menu header or welcome)
  if (variant === 'hero') {
    return (
      <div className={`flex flex-col items-center justify-center text-center ${className}`}>
        <div className="relative p-1.5 sm:p-2 bg-[#FAF7F2] rounded-3xl shadow-md border border-[#E2E8F0] overflow-hidden max-w-[200px] sm:max-w-[240px]">
          <img
            src={OFFICIAL_LOGO_PATH}
            alt="Amandita Sabores - Feito com amor, servido com sabor"
            className="w-full h-auto object-contain rounded-2xl"
            loading="eager"
          />
        </div>
      </div>
    );
  }

  // Badge variant: framed stamp with official emblem
  if (variant === 'badge') {
    return (
      <div className={`inline-flex items-center gap-2 p-1.5 bg-[#FAF7F2] rounded-2xl border border-[#E2E8F0] shadow-xs ${className}`}>
        <img
          src={OFFICIAL_LOGO_PATH}
          alt="Amandita Sabores"
          className="w-9 h-9 object-contain rounded-xl"
        />
        <div className="flex flex-col leading-tight pr-2">
          <span className="font-extrabold text-xs text-[#0F2342] tracking-tight">Amandita</span>
          <span className="text-[9px] font-bold tracking-widest text-[#EA580C] uppercase">Sabores</span>
        </div>
      </div>
    );
  }

  // Default 'full' variant: Clean display of the official logo artwork with natural proportions
  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <div className="shrink-0 rounded-2xl overflow-hidden bg-[#FAF7F2] border border-[#E2E8F0] shadow-xs p-0.5">
        <img
          src={OFFICIAL_LOGO_PATH}
          alt="Amandita Sabores - Feito com amor, servido com sabor"
          className={`${fullDimensions} object-contain rounded-xl`}
          loading="eager"
        />
      </div>
      <div className="flex flex-col text-left leading-tight">
        <div className="flex items-baseline gap-1.5">
          <span
            className={`font-extrabold tracking-tight text-base sm:text-lg ${
              theme === 'light' ? 'text-white' : theme === 'dark' ? 'text-[#F8FAFC]' : 'text-[#0F2342]'
            }`}
          >
            Amandita
          </span>
          <span
            className={`font-sans font-bold tracking-widest text-xs uppercase ${
              theme === 'light' ? 'text-[#FB923C]' : 'text-[#EA580C]'
            }`}
          >
            Sabores
          </span>
        </div>
        {showSlogan && (
          <span
            className={`italic text-[11px] sm:text-xs mt-0.5 ${
              theme === 'light' ? 'text-slate-200/90' : 'text-[#475569]'
            }`}
          >
            Feito com amor, servido com sabor.
          </span>
        )}
      </div>
    </div>
  );
};
