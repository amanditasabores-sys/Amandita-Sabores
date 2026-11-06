import React, { useState, useEffect, useMemo } from 'react';
import { store } from '../../../services/store';
import { MenuItem, Combo, DailyMenuConfig } from '../../../types';
import { formatCurrency } from '../../../utils/formatters';
import { 
  Calendar, 
  Check, 
  CheckSquare, 
  Square, 
  Search, 
  Sparkles, 
  Layers, 
  CheckCircle2, 
  AlertCircle, 
  Filter, 
  X,
  RefreshCw,
  Eye,
  Send,
  Save
} from 'lucide-react';

export const DailyMenuTab: React.FC = () => {
  const [catalogItems, setCatalogItems] = useState<MenuItem[]>(() => store.getMenuItems());
  const [combos, setCombos] = useState<Combo[]>(() => store.getCombos());
  const [dailyConfig, setDailyConfig] = useState<DailyMenuConfig>(() => store.getDailyMenuConfig());

  // Draft selection state
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => {
    const initial = store.getDailyMenuConfig();
    return new Set(initial.draftItemIds || initial.selectedItemIds || []);
  });
  const [selectedComboIds, setSelectedComboIds] = useState<Set<string>>(() => {
    const initial = store.getDailyMenuConfig();
    return new Set(initial.draftComboIds || initial.selectedComboIds || []);
  });

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('TODAS');
  const [viewFilter, setViewFilter] = useState<'all' | 'selected' | 'unselected'>('all');
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'info'; text: string } | null>(null);

  const reload = (syncDrafts = false) => {
    setCatalogItems(store.getMenuItems());
    setCombos(store.getCombos());
    const freshConfig = store.getDailyMenuConfig();
    setDailyConfig(freshConfig);
    if (syncDrafts) {
      setSelectedItemIds(new Set(freshConfig.draftItemIds || freshConfig.selectedItemIds || []));
      setSelectedComboIds(new Set(freshConfig.draftComboIds || freshConfig.selectedComboIds || []));
    }
  };

  useEffect(() => {
    // Initial sync with server so desktop admin sees whatever mobile admin published or drafted
    store.syncDailyMenuWithServer(true).then((synced) => {
      if (synced) {
        reload(true);
      }
    });

    const handleUpdate = () => reload(false);
    window.addEventListener('gestaofood_state_changed', handleUpdate);
    return () => window.removeEventListener('gestaofood_state_changed', handleUpdate);
  }, []);

  // Get distinct categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    catalogItems.forEach((i) => {
      if (i.category && i.category !== 'Combos') set.add(i.category);
    });
    return ['TODAS', ...Array.from(set), 'Combos'];
  }, [catalogItems]);

  // Formatted Brazilian date of reference
  const formattedToday = useMemo(() => {
    const date = new Date();
    return date.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }, []);

  // Filter items
  const filteredItems = useMemo(() => {
    return catalogItems.filter((item) => {
      if (item.category === 'Combos') return false; // Handled in combos section
      if (categoryFilter !== 'TODAS' && item.category !== categoryFilter) return false;

      const isSelected = selectedItemIds.has(item.id);
      if (viewFilter === 'selected' && !isSelected) return false;
      if (viewFilter === 'unselected' && isSelected) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        return item.name.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q);
      }

      return true;
    });
  }, [catalogItems, categoryFilter, viewFilter, search, selectedItemIds]);

  // Filter combos
  const filteredCombos = useMemo(() => {
    if (categoryFilter !== 'TODAS' && categoryFilter !== 'Combos') return [];

    return combos.filter((combo) => {
      const isSelected = selectedComboIds.has(combo.id);
      if (viewFilter === 'selected' && !isSelected) return false;
      if (viewFilter === 'unselected' && isSelected) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        return combo.name.toLowerCase().includes(q) || combo.description?.toLowerCase().includes(q);
      }

      return true;
    });
  }, [combos, categoryFilter, viewFilter, search, selectedComboIds]);

  const toggleItemSelection = (id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleComboSelection = (id: string) => {
    setSelectedComboIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    // Select all available catalog items and active combos
    const itemIds = new Set(catalogItems.filter((i) => i.available !== false).map((i) => i.id));
    const comboIds = new Set(combos.filter((c) => c.active !== false && c.available !== false).map((c) => c.id));
    setSelectedItemIds(itemIds);
    setSelectedComboIds(comboIds);
  };

  const handleClearSelection = () => {
    setSelectedItemIds(new Set());
    setSelectedComboIds(new Set());
  };

  const handleSaveDraft = () => {
    const draftConfig: DailyMenuConfig = {
      ...dailyConfig,
      draftItemIds: Array.from(selectedItemIds),
      draftComboIds: Array.from(selectedComboIds),
      referenceDate: new Date().toISOString().split('T')[0],
    };
    store.saveDailyMenuConfig(draftConfig);
    setFeedbackMessage({
      type: 'info',
      text: 'Rascunho da seleção diária salvo com sucesso! Clique em "Publicar Cardápio" para ativar para os clientes.',
    });
    setTimeout(() => setFeedbackMessage(null), 5000);
  };

  const handlePublish = () => {
    const itemsArr = Array.from(selectedItemIds);
    const combosArr = Array.from(selectedComboIds);

    if (itemsArr.length === 0 && combosArr.length === 0) {
      alert('Selecione pelo menos um produto ou combo para publicar o cardápio do dia.');
      return;
    }

    store.publishDailyMenu(itemsArr, combosArr);
    reload();
    setFeedbackMessage({
      type: 'success',
      text: `Cardápio do dia publicado com sucesso! ${itemsArr.length + combosArr.length} itens agora compõem a seleção oficial do cliente.`,
    });
    setTimeout(() => setFeedbackMessage(null), 6000);
  };

  const handleUnpublish = () => {
    store.unpublishDailyMenu();
    reload();
    setFeedbackMessage({
      type: 'info',
      text: 'Cardápio do dia desativado. O cliente voltará a visualizar o catálogo completo disponível.',
    });
    setTimeout(() => setFeedbackMessage(null), 5000);
  };

  const totalSelectedCount = selectedItemIds.size + selectedComboIds.size;

  return (
    <div className="space-y-6">
      {/* Header Banner & Status */}
      <div className="bg-[#FFFDF9] rounded-2xl p-4 sm:p-5 border border-[#E8DFD5] shadow-xs flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-gradient-to-br from-[#C86D3B] to-[#721C24] text-white rounded-xl shadow-xs">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-[#2C1810]">Cardápio do Dia</h3>
                {dailyConfig.enabled ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>Publicado & Ativo no Link do Cliente</span>
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                    Modo Catálogo Geral (Sem restrição diária)
                  </span>
                )}
              </div>
              <p className="text-xs text-[#8C5E47] capitalize mt-0.5">
                Referência: {formattedToday}
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 w-full lg:w-auto flex-wrap">
          <button
            type="button"
            onClick={handleSaveDraft}
            className="flex-1 sm:flex-none px-3.5 py-2.5 bg-white border border-[#E8DFD5] text-[#2C1810] font-bold rounded-xl text-xs sm:text-sm hover:bg-[#FAF7F2] transition flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <Save className="w-4 h-4 text-[#8C5E47]" />
            <span>Salvar Rascunho</span>
          </button>

          {dailyConfig.enabled && (
            <button
              type="button"
              onClick={handleUnpublish}
              className="px-3.5 py-2.5 bg-slate-100 text-slate-700 font-bold rounded-xl text-xs sm:text-sm hover:bg-slate-200 transition cursor-pointer"
              title="Voltar a exibir todos os produtos do catálogo"
            >
              Exibir Catálogo Completo
            </button>
          )}

          <button
            type="button"
            onClick={handlePublish}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] text-white font-bold rounded-xl text-xs sm:text-sm hover:opacity-95 transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            <span>Publicar Cardápio ({totalSelectedCount})</span>
          </button>
        </div>
      </div>

      {/* Feedback Alert */}
      {feedbackMessage && (
        <div
          className={`p-3.5 rounded-2xl text-xs sm:text-sm flex items-center gap-2 animate-in fade-in duration-200 ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-amber-50 text-amber-900 border border-amber-200'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span className="flex-1">{feedbackMessage.text}</span>
          <button
            onClick={() => setFeedbackMessage(null)}
            className="p-1 text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Controls Bar: Search, Category, Multi-selection */}
      <div className="bg-[#FFFDF9] rounded-2xl p-4 border border-[#E8DFD5] shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#8C5E47] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar produtos ou combos para selecionar..."
              className="w-full pl-10 pr-4 py-2 bg-white border border-[#E8DFD5] rounded-xl text-xs sm:text-sm text-[#2C1810] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C86D3B]"
            />
          </div>

          {/* Bulk Selection Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleSelectAll}
              className="px-3 py-1.5 bg-white border border-[#E8DFD5] hover:bg-[#FAF7F2] text-xs font-bold text-[#2C1810] rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <CheckSquare className="w-3.5 h-3.5 text-[#C86D3B]" />
              <span>Selecionar Todos</span>
            </button>

            <button
              type="button"
              onClick={handleClearSelection}
              className="px-3 py-1.5 bg-white border border-[#E8DFD5] hover:bg-[#FAF7F2] text-xs font-bold text-slate-600 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Square className="w-3.5 h-3.5 text-slate-400" />
              <span>Limpar Seleção</span>
            </button>

            {/* Quick status counter badge */}
            <span className="px-3 py-1.5 rounded-xl bg-[#FAF7F2] border border-[#E8DFD5] text-xs font-bold text-[#721C24]">
              {totalSelectedCount} selecionados
            </span>
          </div>
        </div>

        {/* Categories Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pt-1">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition shrink-0 cursor-pointer ${
                categoryFilter === cat
                  ? 'bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white shadow-2xs'
                  : 'bg-white text-[#8C5E47] border border-[#E8DFD5] hover:text-[#2C1810]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* COMBOS SELECTION SECTION (IF CATEGORY IS ALL OR COMBOS) */}
      {filteredCombos.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs sm:text-sm font-black uppercase tracking-wider text-[#721C24] flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-[#C86D3B]" />
              <span>Combos Promocionais para o Dia ({filteredCombos.length})</span>
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredCombos.map((combo) => {
              const isSelected = selectedComboIds.has(combo.id);

              return (
                <div
                  key={combo.id}
                  onClick={() => toggleComboSelection(combo.id)}
                  className={`p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-amber-50/70 border-[#C86D3B] shadow-xs'
                      : 'bg-white border-[#E8DFD5] hover:border-slate-300 opacity-70'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 overflow-hidden shrink-0">
                      {combo.imageUrl ? (
                        <img
                          src={combo.imageUrl}
                          alt={combo.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-amber-100 text-[#C86D3B] text-xs font-bold">
                          Combo
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="font-bold text-xs text-[#2C1810] block truncate">{combo.name}</span>
                      <span className="text-[11px] text-[#8C5E47] font-mono block">
                        {formatCurrency(combo.comboPrice)} ({combo.items.length} itens)
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0">
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center transition ${
                        isSelected
                          ? 'bg-[#C86D3B] text-white shadow-xs'
                          : 'border-2 border-slate-300 bg-white'
                      }`}
                    >
                      {isSelected && <Check className="w-4 h-4 stroke-[3]" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PRODUCTS SELECTION SECTION */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs sm:text-sm font-black uppercase tracking-wider text-[#2C1810]">
            Produtos Individuais do Catálogo ({filteredItems.length})
          </h4>
        </div>

        {filteredItems.length === 0 ? (
          <div className="bg-[#FFFDF9] rounded-2xl p-8 border border-dashed border-[#E8DFD5] text-center text-xs text-slate-400">
            Nenhum produto correspondente aos filtros.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredItems.map((item) => {
              const isSelected = selectedItemIds.has(item.id);
              const isOutOfStock = item.available === false;

              return (
                <div
                  key={item.id}
                  onClick={() => !isOutOfStock && toggleItemSelection(item.id)}
                  className={`p-3 rounded-2xl border transition flex items-center justify-between gap-3 ${
                    isOutOfStock
                      ? 'bg-slate-50 border-slate-200 opacity-40 cursor-not-allowed'
                      : isSelected
                      ? 'bg-[#FFF9F5] border-[#C86D3B] shadow-xs cursor-pointer'
                      : 'bg-white border-[#E8DFD5] hover:border-slate-300 opacity-70 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 overflow-hidden shrink-0">
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-[#2C1810] truncate max-w-[170px]">{item.name}</span>
                        {isOutOfStock && (
                          <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-1 rounded-sm">
                            Esgotado
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#8C5E47] truncate">{item.category}</p>
                      <span className="text-[11px] font-mono font-bold text-[#721C24]">
                        {formatCurrency(item.price)}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0">
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center transition ${
                        isOutOfStock
                          ? 'bg-slate-200 border border-slate-300'
                          : isSelected
                          ? 'bg-[#C86D3B] text-white shadow-xs'
                          : 'border-2 border-slate-300 bg-white'
                      }`}
                    >
                      {isSelected && <Check className="w-4 h-4 stroke-[3]" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
