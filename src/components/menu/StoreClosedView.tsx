import React from 'react';
import { Clock, MapPin, Phone, Heart, MessageCircle } from 'lucide-react';
import { AmanditaLogo } from '../common/AmanditaLogo';
import { DayOfWeekKey, PublicStoreAvailability, RestaurantConfig } from '../../types';
import {
  DEFAULT_CLOSED_PRIMARY_MESSAGE,
  DEFAULT_CLOSED_SECONDARY_MESSAGE,
  buildWhatsAppUrl,
  formatWhatsAppDisplay,
  getDayOperatingShifts,
  normalizeClosedSettings,
} from '../../utils/storeHours';

interface StoreClosedViewProps {
  availability: PublicStoreAvailability | null;
  config: RestaurantConfig;
  rejectionNotice?: string | null;
}

const JS_DAY_TO_KEY: DayOfWeekKey[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

export const StoreClosedView: React.FC<StoreClosedViewProps> = ({
  availability,
  config,
  rejectionNotice,
}) => {
  const closedSettings = normalizeClosedSettings(availability?.closedSettings || config);
  const publicInfo = availability?.restaurantPublicInfo;

  const storeName = (publicInfo?.name || config.name || 'Amandita Sabores').trim();
  const whatsappRaw = (publicInfo?.whatsapp || config.whatsapp || '').trim();
  const formattedWhatsapp = formatWhatsAppDisplay(whatsappRaw);
  const whatsappUrl = buildWhatsAppUrl(
    whatsappRaw,
    `Olá! Vi que a ${storeName} está fechada no momento pelo cardápio e gostaria de tirar uma dúvida.`
  );
  const address = (publicInfo?.address || config.address || '').trim();
  const city = (publicInfo?.city || config.city || '').trim();

  const primaryMessage = closedSettings.closedPrimaryMessage || DEFAULT_CLOSED_PRIMARY_MESSAGE;
  const secondaryMessage = closedSettings.closedSecondaryMessage || DEFAULT_CLOSED_SECONDARY_MESSAGE;
  const todayKey = JS_DAY_TO_KEY[new Date().getDay()];
  const isVerificationUnavailable = availability?.verified === false;

  return (
    <div
      data-testid="store-closed-page"
      className="min-h-screen w-full max-w-full bg-[#FAF7F2] text-[#2C1810] flex flex-col justify-center px-4 py-8 sm:py-12"
    >
      <div className="w-full max-w-lg mx-auto">
        <div className="bg-[#FFFDF9] rounded-3xl p-6 sm:p-9 border border-[#E8DFD5] shadow-xl space-y-6 text-center">
          {rejectionNotice && (
            <div
              role="alert"
              className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-semibold text-left leading-relaxed"
            >
              {rejectionNotice}
            </div>
          )}

          {/* 1. Original Amandita Logo */}
          <div className="flex justify-center">
            <AmanditaLogo variant="full" size="lg" theme="light" />
          </div>

          {/* 2 & 3. Establishment Name + Highlighted Primary Closed Message */}
          <div className="space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-[#721C24]/10 text-[#721C24] border border-[#721C24]/25">
              <Clock className="w-3.5 h-3.5" />
              <span>
                {isVerificationUnavailable
                  ? 'Atendimento Temporariamente Indisponível'
                  : 'Estabelecimento Fechado no Momento'}
              </span>
            </div>

            <p className="text-xs font-bold uppercase tracking-widest text-[#8C5E47]">
              {storeName}
            </p>

            <h1 className="font-serif font-black text-2xl sm:text-3xl text-[#2C1810] leading-tight">
              {primaryMessage}
            </h1>

            {/* 4. Complementary Closure Explanation & Invitation */}
            <p className="text-xs sm:text-sm text-[#6B4B3E] leading-relaxed max-w-md mx-auto">
              {secondaryMessage}
            </p>
          </div>

          {/* 5. Configured Operating Days & Hours */}
          <div className="bg-[#FAF7F2] rounded-2xl p-4 sm:p-5 border border-[#E8DFD5] text-left space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E8DFD5]">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#C86D3B]" />
                <h2 className="font-serif font-bold text-sm text-[#2C1810]">
                  Horários de Funcionamento
                </h2>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8C5E47]">
                Atendimento
              </span>
            </div>

            <ul className="space-y-1.5">
              {closedSettings.operatingHours.map((day) => {
                const isToday = day.dayKey === todayKey;
                const shifts = getDayOperatingShifts(day);
                return (
                  <li
                    key={day.dayKey}
                    className={`flex items-start justify-between gap-3 px-2.5 py-1.5 rounded-xl text-xs transition ${
                      isToday
                        ? 'bg-[#FFFDF9] border border-[#C86D3B]/40 font-bold text-[#2C1810] shadow-2xs'
                        : 'text-[#6B4B3E]'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 pt-0.5">
                      <span>{day.label}</span>
                      {isToday && (
                        <span className="text-[10px] font-bold text-[#C86D3B] uppercase">
                          (Hoje)
                        </span>
                      )}
                    </span>

                    {shifts.length > 0 ? (
                      <div className="flex flex-col items-end gap-0.5 font-mono font-semibold text-[#2C1810] text-right">
                        {shifts.map((shift, idx) => (
                          <span key={`${day.dayKey}-shift-${idx}`}>
                            {shift.openTime} às {shift.closeTime}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] font-semibold text-[#721C24] bg-[#721C24]/10 px-2 py-0.5 rounded-lg">
                        Sem funcionamento
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* 6 & 7. Formatted WhatsApp Number & Direct CTA Button */}
          {whatsappRaw && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-center gap-1.5 text-xs text-[#6B4B3E]">
                <Phone className="w-3.5 h-3.5 text-[#C86D3B]" />
                <span>WhatsApp Amandita:</span>
                <strong className="font-mono text-[#2C1810]">{formattedWhatsapp || whatsappRaw}</strong>
              </div>

              {whatsappUrl && (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 w-full py-3.5 px-4 bg-[#25D366] hover:bg-[#20BD5A] text-white font-extrabold rounded-2xl text-xs sm:text-sm shadow-md transition"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>Falar com o Amandita no WhatsApp</span>
                </a>
              )}
            </div>
          )}

          {/* 8. Final Thank-you Message & Store Address */}
          <div className="pt-4 border-t border-[#E8DFD5] space-y-2">
            <p className="text-xs font-serif font-bold text-[#721C24] flex items-center justify-center gap-1.5">
              <Heart className="w-3.5 h-3.5 text-[#C86D3B]" />
              <span>Agradecemos pela preferência e carinho! Esperamos você em breve.</span>
            </p>
            {(address || city) && (
              <p className="text-[11px] text-[#8C5E47] flex items-center justify-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-[#C86D3B] shrink-0" />
                <span>{[address, city].filter(Boolean).join(' — ')}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
