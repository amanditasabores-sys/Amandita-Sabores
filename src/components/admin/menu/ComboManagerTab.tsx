import React, { useState, useEffect, useMemo } from 'react';
import { store } from '../../../services/store';
import { Combo, ComboComponent, MenuItem } from '../../../types';
import { formatCurrency } from '../../../utils/formatters';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Copy, 
  Check, 
  X, 
  Sparkles, 
  Layers, 
  Package, 
  Tag, 
  Eye, 
  EyeOff, 
  AlertCircle,
  ArrowRight,
  TrendingDown
} from 'lucide-react';
import { ConfirmModal } from '../../common/ConfirmModal';

export const ComboManagerTab: React.FC = () => {
  const [combos, setCombos] = useState<Combo[]>(() => store.getCombos());
  const [catalogItems, setCatalogItems] = useState<MenuItem[]>(() => store.getMenuItems());
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Modal create/edit state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCombo, setEditingCombo] = useState<Combo | null>(null);
  const [comboToDelete, setComboToDelete] = useState<Combo | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [category, setCategory] = useState('Combos');
  const [comboPrice, setComboPrice] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isFeatured, setIsFeatured] = useState(false);
  const [tagsInput, setTagsInput] = useState('');
  const [selectedComponents, setSelectedComponents] = useState<ComboComponent[]>([]);

  // Item selector in form
  const [componentSearch, setComponentSearch] = useState('');
  const [selectedAddItemId, setSelectedAddItemId] = useState('');
  const [selectedAddQuantity, setSelectedAddQuantity] = useState(1);

  const reload = () => {
    setCombos(store.getCombos());
    setCatalogItems(store.getMenuItems());
  };

  useEffect(() => {
    const handleUpdate = () => reload();
    window.addEventListener('gestaofood_state_changed', handleUpdate);
    return () => window.removeEventListener('gestaofood_state_changed', handleUpdate);
  }, []);

  // Filtered combos
  const filteredCombos = useMemo(() => {
    return combos.filter((c) => {
      const matchSearch = 
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.description.toLowerCase().includes(search.toLowerCase()) ||
        c.items.some((it) => it.name.toLowerCase().includes(search.toLowerCase()));

      if (!matchSearch) return false;
      if (activeFilter === 'active') return c.active !== false;
      if (activeFilter === 'inactive') return c.active === false;
      return true;
    });
  }, [combos, search, activeFilter]);

  // Available catalog items for adding as components (excluding existing combos)
  const availableCatalogItems = useMemo(() => {
    return catalogItems.filter((i) => i.category !== 'Combos');
  }, [catalogItems]);

  // Calculate live sum of components
  const calculatedOriginalPrice = useMemo(() => {
    return selectedComponents.reduce((sum, comp) => sum + (comp.originalPrice * comp.quantity), 0);
  }, [selectedComponents]);

  // Calculate discount percentage
  const discountPercentage = useMemo(() => {
    const priceNum = parseFloat(comboPrice) || 0;
    if (calculatedOriginalPrice <= 0 || priceNum <= 0 || priceNum >= calculatedOriginalPrice) return 0;
    return Math.round(((calculatedOriginalPrice - priceNum) / calculatedOriginalPrice) * 100);
  }, [calculatedOriginalPrice, comboPrice]);

  const handleOpenCreate = () => {
    setEditingCombo(null);
    setName('');
    setDescription('');
    setImageUrl('https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?auto=format&fit=crop&w=700&q=80');
    setCategory('Combos');
    setComboPrice('');
    setIsActive(true);
    setIsFeatured(false);
    setTagsInput('Mais Vendido, Economia');
    setSelectedComponents([]);
    setSelectedAddItemId(availableCatalogItems[0]?.id || '');
    setSelectedAddQuantity(1);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (combo: Combo) => {
    setEditingCombo(combo);
    setName(combo.name);
    setDescription(combo.description);
    setImageUrl(combo.imageUrl || '');
    setCategory(combo.category || 'Combos');
    setComboPrice(String(combo.comboPrice));
    setIsActive(combo.active !== false);
    setIsFeatured(!!combo.featured);
    setTagsInput(combo.tags?.join(', ') || '');
    setSelectedComponents([...combo.items]);
    setSelectedAddItemId(availableCatalogItems[0]?.id || '');
    setSelectedAddQuantity(1);
    setIsModalOpen(true);
  };

  const handleDuplicate = (combo: Combo) => {
    const copy = store.duplicateCombo(combo.id);
    if (copy) {
      reload();
    }
  };

  const handleToggleActive = (combo: Combo) => {
    store.toggleComboActive(combo.id);
    reload();
  };

  const handleAddComponent = () => {
    if (!selectedAddItemId) return;
    const item = availableCatalogItems.find((i) => i.id === selectedAddItemId);
    if (!item) return;

    const existingIndex = selectedComponents.findIndex((c) => c.menuItemId === item.id);
    if (existingIndex >= 0) {
      const updated = [...selectedComponents];
      updated[existingIndex].quantity += selectedAddQuantity;
      setSelectedComponents(updated);
    } else {
      setSelectedComponents([
        ...selectedComponents,
        {
          menuItemId: item.id,
          name: item.name,
          quantity: selectedAddQuantity,
          originalPrice: item.price,
        },
      ]);
    }

    setSelectedAddQuantity(1);
  };

  const handleRemoveComponent = (menuItemId: string) => {
    setSelectedComponents(selectedComponents.filter((c) => c.menuItemId !== menuItemId));
  };

  const handleComponentQuantityChange = (menuItemId: string, newQty: number) => {
    if (newQty <= 0) {
      handleRemoveComponent(menuItemId);
      return;
    }
    setSelectedComponents(
      selectedComponents.map((c) => (c.menuItemId === menuItemId ? { ...c, quantity: newQty } : c))
    );
  };

  const handleSaveCombo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (selectedComponents.length === 0) {
      alert('Adicione pelo menos um produto para compor o combo.');
      return;
    }

    const priceNum = parseFloat(comboPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      alert('Informe um preço especial válido para o combo.');
      return;
    }

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const comboData: Combo = {
      id: editingCombo ? editingCombo.id : `combo-${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      imageUrl: imageUrl.trim() || undefined,
      category: category.trim() || 'Combos',
      items: selectedComponents,
      originalPrice: calculatedOriginalPrice,
      comboPrice: priceNum,
      active: isActive,
      available: isActive && selectedComponents.every((c) => {
        const found = catalogItems.find((it) => it.id === c.menuItemId);
        return found && found.available !== false;
      }),
      featured: isFeatured,
      tags: tags.length > 0 ? tags : ['Combo'],
    };

    store.saveCombo(comboData);
    setIsModalOpen(false);
    reload();
  };

  const handleDeleteConfirm = () => {
    if (!comboToDelete) return;
    store.deleteCombo(comboToDelete.id);
    setComboToDelete(null);
    reload();
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Actions Bar */}
      <div className="bg-[#FFFDF9] rounded-2xl p-4 sm:p-5 border border-[#E8DFD5] shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-gradient-to-br from-[#C86D3B] to-[#721C24] text-white rounded-xl shadow-xs">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-[#2C1810]">Gestão de Combos</h3>
              <p className="text-xs text-[#8C5E47]">
                Crie combinações especiais de produtos com desconto exclusivo para atrair clientes.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleOpenCreate}
          className="w-full sm:w-auto px-4 py-2.5 bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] text-white font-bold rounded-xl text-xs sm:text-sm hover:opacity-95 transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Criar Novo Combo</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#8C5E47] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome do combo ou item incluso..."
            className="w-full pl-10 pr-4 py-2 bg-white border border-[#E8DFD5] rounded-xl text-xs sm:text-sm text-[#2C1810] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C86D3B]/40 focus:border-[#C86D3B]"
          />
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-white border border-[#E8DFD5] rounded-xl shrink-0">
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
              activeFilter === 'all' ? 'bg-[#2C1810] text-white' : 'text-[#8C5E47] hover:text-[#2C1810]'
            }`}
          >
            Todos ({combos.length})
          </button>
          <button
            onClick={() => setActiveFilter('active')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
              activeFilter === 'active' ? 'bg-emerald-600 text-white' : 'text-[#8C5E47] hover:text-[#2C1810]'
            }`}
          >
            Ativos ({combos.filter((c) => c.active !== false).length})
          </button>
          <button
            onClick={() => setActiveFilter('inactive')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
              activeFilter === 'inactive' ? 'bg-slate-700 text-white' : 'text-[#8C5E47] hover:text-[#2C1810]'
            }`}
          >
            Inativos ({combos.filter((c) => c.active === false).length})
          </button>
        </div>
      </div>

      {/* Combos Cards Grid */}
      {filteredCombos.length === 0 ? (
        <div className="bg-[#FFFDF9] rounded-2xl p-8 border border-dashed border-[#E8DFD5] text-center">
          <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <h4 className="font-bold text-sm text-[#2C1810]">Nenhum combo encontrado</h4>
          <p className="text-xs text-[#8C5E47] mt-1">
            {search ? 'Tente buscar com outros termos.' : 'Clique em "Criar Novo Combo" para montar sua primeira oferta.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {filteredCombos.map((combo) => {
            const hasStockIssue = !combo.available && combo.active !== false;

            return (
              <div
                key={combo.id}
                className={`bg-[#FFFDF9] rounded-2xl border transition shadow-xs overflow-hidden flex flex-col justify-between ${
                  combo.active === false
                    ? 'border-slate-200 opacity-60'
                    : hasStockIssue
                    ? 'border-amber-300 bg-amber-50/20'
                    : 'border-[#E8DFD5] hover:border-[#C86D3B]/50 hover:shadow-md'
                }`}
              >
                <div>
                  {/* Image & Header */}
                  <div className="relative h-40 bg-slate-100 overflow-hidden">
                    {combo.imageUrl ? (
                      <img
                        src={combo.imageUrl}
                        alt={combo.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-[#FAF7F2] text-[#8C5E47]">
                        <Package className="w-10 h-10 opacity-40" />
                      </div>
                    )}

                    <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5">
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-[#2C1810]/90 text-white shadow-xs backdrop-blur-xs">
                        COMBO
                      </span>
                      {combo.featured && (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-amber-500 text-white shadow-xs flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          <span>Destaque</span>
                        </span>
                      )}
                    </div>

                    <div className="absolute top-2.5 right-2.5">
                      {combo.active === false ? (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-800 text-white shadow-xs">
                          Inativo
                        </span>
                      ) : hasStockIssue ? (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-500 text-white shadow-xs flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          <span>Item Indisponível</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-600 text-white shadow-xs">
                          Disponível
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="p-4">
                    <h4 className="font-black text-sm sm:text-base text-[#2C1810] leading-snug">{combo.name}</h4>
                    {combo.description && (
                      <p className="text-xs text-[#8C5E47] mt-1 line-clamp-2 leading-relaxed">
                        {combo.description}
                      </p>
                    )}

                    {/* Component Items List */}
                    <div className="mt-3.5 pt-3 border-t border-[#E8DFD5] space-y-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#8C5E47] block">
                        Produtos Inclusos ({combo.items.length}):
                      </span>
                      <ul className="space-y-1">
                        {combo.items.map((comp, idx) => (
                          <li key={idx} className="text-xs text-[#3D2314] flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <span className="font-bold text-[#C86D3B]">{comp.quantity}x</span>
                              <span className="truncate max-w-[170px]">{comp.name}</span>
                            </span>
                            <span className="text-[11px] text-[#8C5E47] font-mono">
                              {formatCurrency(comp.originalPrice * comp.quantity)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Pricing Breakdown */}
                    <div className="mt-3.5 pt-3 border-t border-[#E8DFD5] flex items-baseline justify-between">
                      <div>
                        {combo.originalPrice > combo.comboPrice && (
                          <span className="text-xs text-slate-400 line-through block font-mono">
                            De {formatCurrency(combo.originalPrice)}
                          </span>
                        )}
                        <span className="text-base sm:text-lg font-black text-[#721C24] font-mono">
                          {formatCurrency(combo.comboPrice)}
                        </span>
                      </div>

                      {combo.originalPrice > combo.comboPrice && (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                          <TrendingDown className="w-3 h-3" />
                          <span>Economia de {formatCurrency(combo.originalPrice - combo.comboPrice)}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Action Buttons */}
                <div className="p-3 bg-[#FAF7F2] border-t border-[#E8DFD5] flex items-center justify-between gap-1.5">
                  <button
                    onClick={() => handleToggleActive(combo)}
                    className={`p-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      combo.active === false
                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                    title={combo.active === false ? 'Ativar combo' : 'Desativar combo'}
                  >
                    {combo.active === false ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    <span className="text-[11px]">{combo.active === false ? 'Ativar' : 'Pausar'}</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDuplicate(combo)}
                      className="p-2 text-[#8C5E47] hover:text-[#2C1810] hover:bg-white rounded-xl transition cursor-pointer"
                      title="Duplicar combo"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleOpenEdit(combo)}
                      className="p-2 text-[#C86D3B] hover:text-[#721C24] hover:bg-white rounded-xl transition cursor-pointer"
                      title="Editar combo"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setComboToDelete(combo)}
                      className="p-2 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-xl transition cursor-pointer"
                      title="Excluir combo"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Criar / Editar Combo */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-[#E8DFD5]">
            <div className="sticky top-0 bg-[#FFFDF9] px-5 sm:px-6 py-4 border-b border-[#E8DFD5] flex items-center justify-between z-10">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-gradient-to-br from-[#C86D3B] to-[#721C24] text-white rounded-xl shadow-xs">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-black text-sm sm:text-base text-[#2C1810]">
                    {editingCombo ? 'Editar Combo' : 'Novo Combo Promocional'}
                  </h3>
                  <p className="text-[11px] text-[#8C5E47]">Amandita Sabores · Catálogo Oficial</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-[#2C1810] rounded-xl hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCombo} className="p-5 sm:p-6 space-y-4">
              {/* Nome do Combo */}
              <div>
                <label className="block text-xs font-bold text-[#3D2314] uppercase tracking-wider mb-1">
                  Nome do Combo *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Combo Café Nordestino, Combo Amandita Duplo..."
                  className="w-full px-3.5 py-2.5 bg-[#FAF7F2] border border-[#E8DFD5] rounded-xl text-sm text-[#2C1810] focus:outline-none focus:ring-2 focus:ring-[#C86D3B]"
                />
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-xs font-bold text-[#3D2314] uppercase tracking-wider mb-1">
                  Descrição Atrativa
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descreva o que torna esta combinação especial..."
                  className="w-full px-3.5 py-2 bg-[#FAF7F2] border border-[#E8DFD5] rounded-xl text-xs text-[#2C1810] focus:outline-none focus:ring-2 focus:ring-[#C86D3B]"
                />
              </div>

              {/* URL da Imagem */}
              <div>
                <label className="block text-xs font-bold text-[#3D2314] uppercase tracking-wider mb-1">
                  URL da Fotografia
                </label>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className="w-full px-3.5 py-2 bg-[#FAF7F2] border border-[#E8DFD5] rounded-xl text-xs text-[#2C1810] focus:outline-none focus:ring-2 focus:ring-[#C86D3B]"
                />
              </div>

              {/* COMPONENTES DO COMBO (SELETOR INTELIGENTE) */}
              <div className="p-4 bg-[#FAF7F2] rounded-2xl border border-[#E8DFD5] space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-[#2C1810] uppercase tracking-wider flex items-center gap-1.5">
                    <Package className="w-4 h-4 text-[#C86D3B]" />
                    <span>Produtos do Catálogo que Compõem o Combo *</span>
                  </label>
                  <span className="text-[11px] font-mono text-[#8C5E47]">
                    Soma Normal: {formatCurrency(calculatedOriginalPrice)}
                  </span>
                </div>

                {/* Adicionar Componente */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <select
                    value={selectedAddItemId}
                    onChange={(e) => setSelectedAddItemId(e.target.value)}
                    className="flex-1 px-3 py-2 bg-white border border-[#E8DFD5] rounded-xl text-xs text-[#2C1810] focus:outline-none focus:ring-2 focus:ring-[#C86D3B]"
                  >
                    {availableCatalogItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} — {formatCurrency(item.price)} ({item.category})
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center border border-[#E8DFD5] rounded-xl bg-white overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setSelectedAddQuantity(Math.max(1, selectedAddQuantity - 1))}
                        className="px-2 py-1.5 text-xs text-[#8C5E47] hover:bg-slate-50 cursor-pointer"
                      >
                        -
                      </button>
                      <span className="px-2.5 text-xs font-bold text-[#2C1810]">{selectedAddQuantity}</span>
                      <button
                        type="button"
                        onClick={() => setSelectedAddQuantity(selectedAddQuantity + 1)}
                        className="px-2 py-1.5 text-xs text-[#8C5E47] hover:bg-slate-50 cursor-pointer"
                      >
                        +
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddComponent}
                      className="px-3 py-2 bg-[#2C1810] text-white text-xs font-bold rounded-xl hover:bg-[#3D2314] transition cursor-pointer flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Adicionar</span>
                    </button>
                  </div>
                </div>

                {/* Lista de Componentes Selecionados */}
                {selectedComponents.length === 0 ? (
                  <div className="p-3 bg-white rounded-xl border border-dashed border-[#E8DFD5] text-center text-xs text-slate-400">
                    Nenhum produto adicionado. Escolha itens acima para montar o combo.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {selectedComponents.map((comp) => (
                      <div
                        key={comp.menuItemId}
                        className="p-2 bg-white rounded-xl border border-[#E8DFD5] flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-bold text-[#C86D3B]">{comp.quantity}x</span>
                          <span className="font-medium text-[#2C1810] truncate max-w-[200px]">{comp.name}</span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            ({formatCurrency(comp.originalPrice)} un.)
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono font-bold text-[#2C1810]">
                            {formatCurrency(comp.originalPrice * comp.quantity)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveComponent(comp.menuItemId)}
                            className="p-1 text-slate-400 hover:text-rose-600 transition cursor-pointer"
                            title="Remover produto do combo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Preço Especial do Combo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#3D2314] uppercase tracking-wider mb-1">
                    Preço Especial do Combo (R$) *
                  </label>
                  <div className="relative">
                    <span className="text-xs text-[#8C5E47] font-bold absolute left-3.5 top-1/2 -translate-y-1/2">
                      R$
                    </span>
                    <input
                      type="number"
                      step="0.10"
                      required
                      value={comboPrice}
                      onChange={(e) => setComboPrice(e.target.value)}
                      placeholder="0,00"
                      className="w-full pl-10 pr-3.5 py-2.5 bg-[#FAF7F2] border border-[#E8DFD5] rounded-xl text-sm font-mono font-bold text-[#721C24] focus:outline-none focus:ring-2 focus:ring-[#C86D3B]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#3D2314] uppercase tracking-wider mb-1">
                    Desconto Estimado
                  </label>
                  <div className="h-[42px] px-3 bg-[#FAF7F2] border border-[#E8DFD5] rounded-xl flex items-center justify-between text-xs">
                    <span className="text-[#8C5E47]">Vantagem para o cliente:</span>
                    <span className="font-bold text-rose-700">
                      {discountPercentage > 0 ? `${discountPercentage}% OFF` : 'Sem desconto'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Tags & Opções */}
              <div>
                <label className="block text-xs font-bold text-[#3D2314] uppercase tracking-wider mb-1">
                  Tags (Separadas por vírgula)
                </label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="Mais Vendido, Economia, Café da Manhã..."
                  className="w-full px-3.5 py-2 bg-[#FAF7F2] border border-[#E8DFD5] rounded-xl text-xs text-[#2C1810] focus:outline-none focus:ring-2 focus:ring-[#C86D3B]"
                />
              </div>

              <div className="flex items-center gap-6 pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-[#2C1810]">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="w-4 h-4 text-[#C86D3B] rounded-sm focus:ring-[#C86D3B]"
                  />
                  <span>Combo Ativo (visível no cardápio)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-[#2C1810]">
                  <input
                    type="checkbox"
                    checked={isFeatured}
                    onChange={(e) => setIsFeatured(e.target.checked)}
                    className="w-4 h-4 text-[#C86D3B] rounded-sm focus:ring-[#C86D3B]"
                  />
                  <span>Destaque no topo</span>
                </label>
              </div>

              {/* Buttons */}
              <div className="pt-4 border-t border-[#E8DFD5] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 text-xs font-bold text-[#8C5E47] hover:text-[#2C1810] transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] text-white text-xs sm:text-sm font-bold rounded-xl hover:opacity-95 transition shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{editingCombo ? 'Salvar Alterações' : 'Criar Combo'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmação de Exclusão */}
      <ConfirmModal
        isOpen={Boolean(comboToDelete)}
        title="Excluir Combo"
        message={`Tem certeza que deseja excluir o combo "${comboToDelete?.name}"? Esta ação removerá o combo do cardápio, mas os produtos individuais permanecerão intactos no catálogo.`}
        confirmLabel="Excluir Combo"
        isDanger={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setComboToDelete(null)}
      />
    </div>
  );
};
