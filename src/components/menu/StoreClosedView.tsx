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
      className="min-h-screen w-full max-w-full bg-[#F8FAFC] text-[#0F2342] flex flex-col justify-center px-4 py-8 sm:py-12"
    >
      <div className="w-full max-w-lg mx-auto">
        <div className="bg-white rounded-3xl border border-[#E2E8F0] shadow-sm overflow-hidden">
          {/* Brand Header Band (Navy #0F2342 for high-contrast official logo) */}
          <div className="bg-[#0F2342] px-6 py-6 sm:px-8 sm:py-7 text-center border-b border-[#1B365D] space-y-4">
            <div className="flex justify-center">
              <AmanditaLogo variant="full" size="lg" theme="light" />
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-white/10 text-[#FB923C] border border-white/15">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>
                {isVerificationUnavailable
                  ? 'Atendimento Temporariamente Indisponível'
                  : 'Estabelecimento Fechado no Momento'}
              </span>
            </div>
          </div>

          <div className="p-6 sm:p-8 space-y-6 text-center">
            {rejectionNotice && (
              <div
                role="alert"
                className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-semibold text-left leading-relaxed"
              >
                {rejectionNotice}
              </div>
            )}

            {/* Establishment Name + Highlighted Primary & Complementary Closed Messages */}
            <div className="space-y-2.5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#EA580C]">
                {storeName}
              </p>

              <h1 className="font-extrabold text-xl sm:text-2xl text-[#0F2342] leading-tight tracking-tight">
                {primaryMessage}
              </h1>

              <p className="text-xs sm:text-sm text-[#475569] leading-relaxed max-w-md mx-auto">
                {secondaryMessage}
              </p>
            </div>

            {/* Configured Operating Days & Hours */}
            <div className="bg-[#F8FAFC] rounded-2xl p-4 sm:p-5 border border-[#E2E8F0] text-left space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[#E2E8F0]">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#EA580C]" />
                  <h2 className="font-bold text-sm text-[#0F2342]">
                    Horários de Funcionamento
                  </h2>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
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
                      className={`flex items-start justify-between gap-3 px-3 py-2 rounded-xl text-xs transition ${
                        isToday
                          ? 'bg-[#FFF7ED] border border-[#FED7AA] font-bold text-[#0F2342]'
                          : 'text-[#475569]'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 pt-0.5">
                        <span>{day.label}</span>
                        {isToday && (
                          <span className="text-[10px] font-extrabold text-[#EA580C] uppercase">
                            (Hoje)
                          </span>
                        )}
                      </span>

                      {shifts.length > 0 ? (
                        <div className="flex flex-col items-end gap-0.5 font-mono tabular-nums font-semibold text-[#0F2342] text-right">
                          {shifts.map((shift, idx) => (
                            <span key={`${day.dayKey}-shift-${idx}`}>
                              {shift.openTime} às {shift.closeTime}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] font-semibold text-[#64748B] bg-slate-100 border border-[#E2E8F0] px-2 py-0.5 rounded-lg">
                          Sem funcionamento
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Formatted WhatsApp Number & Direct CTA Button */}
            {whatsappRaw && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-center gap-1.5 text-xs text-[#475569]">
                  <Phone className="w-3.5 h-3.5 text-[#EA580C]" />
                  <span>WhatsApp Amandita:</span>
                  <strong className="font-mono tabular-nums text-[#0F2342]">
                    {formattedWhatsapp || whatsappRaw}
                  </strong>
                </div>

                {whatsappUrl && (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 w-full min-h-[46px] py-3 px-4 bg-[#25D366] hover:bg-[#20BD5A] text-white font-bold rounded-2xl text-xs sm:text-sm shadow-sm transition"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>Falar com o Amandita no WhatsApp</span>
                  </a>
                )}
              </div>
            )}

            {/* Final Thank-you Message & Store Address */}
            <div className="pt-4 border-t border-[#E2E8F0] space-y-2">
              <p className="text-xs font-bold text-[#0F2342] flex items-center justify-center gap-1.5">
                <Heart className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
                <span>Agradecemos pela preferência e carinho! Esperamos você em breve.</span>
              </p>
              {(address || city) && (
                <p className="text-[11px] text-[#64748B] flex items-center justify-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
                  <span>{[address, city].filter(Boolean).join(' — ')}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
