import React from 'react';

interface AmanditaLogoProps {
  variant?: 'full' | 'icon' | 'badge';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  theme?: 'dark' | 'light' | 'colored';
  className?: string;
}

export const AmanditaLogo: React.FC<AmanditaLogoProps> = ({
  variant = 'full',
  size = 'md',
  theme = 'colored',
  className = '',
}) => {
  // Dimensions based on size
  const iconDimensions = {
    sm: 'w-7 h-7',
    md: 'w-9 h-9',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16',
  }[size];

  const textSize = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl',
    xl: 'text-2xl',
  }[size];

  const subtextSize = {
    sm: 'text-[9px]',
    md: 'text-[10px]',
    lg: 'text-xs',
    xl: 'text-sm',
  }[size];

  // Artisanal Emblem SVG
  const LogoIcon = (
    <div
      className={`${iconDimensions} relative shrink-0 rounded-2xl flex items-center justify-center shadow-xs transition-transform ${
        theme === 'light'
          ? 'bg-amber-100 text-[#361E15] border border-amber-200/50'
          : theme === 'dark'
          ? 'bg-[#2C1810] text-[#E89255] border border-[#C86D3B]/40'
          : 'bg-gradient-to-br from-[#C86D3B] via-[#B85D2A] to-[#721C24] text-[#FFF7ED] border border-[#C86D3B]/50'
      }`}
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-[78%] h-[78%]"
      >
        {/* Outer artisanal dotted border */}
        <circle cx="50" cy="50" r="45" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 3" opacity="0.65" />
        <circle cx="50" cy="50" r="41" stroke="currentColor" strokeWidth="1.2" opacity="0.85" />
        
        {/* Steam / Aroma waves above dish */}
        <path
          d="M40 32C39 26 44 23 42 17"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.9"
        />
        <path
          d="M50 30C49 22 55 19 53 14"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
        <path
          d="M60 32C61 26 56 23 58 17"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.9"
        />

        {/* Artisanal Cloche / Pan / Cuscuz steaming shape */}
        <path
          d="M26 54C26 40 37 36 50 36C63 36 74 40 74 54H26Z"
          fill="currentColor"
          fillOpacity="0.22"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        {/* Base dish / board */}
        <path
          d="M20 57C20 55.5 22 54 25 54H75C78 54 80 55.5 80 57C80 60 74 62 50 62C26 62 20 60 20 57Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="2"
        />

        {/* Decorative Wheat / Flour Ears */}
        <path
          d="M32 74C37 70 42 70 47 73M53 73C58 70 63 70 68 74"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle cx="50" cy="73" r="2.5" fill="currentColor" />
        
        {/* Small warm heart in center */}
        <path
          d="M50 48C50 48 46 44 43 46C40 48 41 51 50 55C59 51 60 48 57 46C54 44 50 48 50 48Z"
          fill="currentColor"
        />
      </svg>
    </div>
  );

  if (variant === 'icon') {
    return <div className={`inline-flex items-center ${className}`}>{LogoIcon}</div>;
  }

  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      {LogoIcon}
      <div className="flex flex-col text-left leading-none">
        <div className="flex items-center gap-1.5">
          <span
            className={`font-black tracking-tight ${textSize} ${
              theme === 'light'
                ? 'text-white'
                : theme === 'dark'
                ? 'text-[#FFF7ED]'
                : 'text-[#361E15]'
            }`}
            style={{ fontFamily: "'Plus Jakarta Sans', Georgia, serif" }}
          >
            Amandita
          </span>
          <span
            className={`font-extrabold italic tracking-wider ${textSize} ${
              theme === 'light'
                ? 'text-amber-300'
                : 'text-[#C86D3B]'
            }`}
          >
            Sabores
          </span>
        </div>
        <span
          className={`font-medium tracking-widest uppercase mt-0.5 ${subtextSize} ${
            theme === 'light'
              ? 'text-amber-200/80'
              : 'text-[#8C5E47]'
          }`}
        >
          Tradição & Afeto Artesanal
        </span>
      </div>
    </div>
  );
};
