import React, { useState } from 'react';
import { store } from '../../services/store';
import { MenuItem, MenuItemAddon } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Check, 
  X, 
  Clock, 
  Sparkles, 
  Image as ImageIcon 
} from 'lucide-react';
import { ConfirmModal } from '../common/ConfirmModal';

const PRESET_IMAGES = [
  { label: 'Hambúrguer 1', url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=700&q=80' },
  { label: 'Hambúrguer 2', url: 'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?auto=format&fit=crop&w=700&q=80' },
  { label: 'Pizza Margherita', url: 'https://images.unsplash.com/photo-1604382355076-af4b0eb60143?auto=format&fit=crop&w=700&q=80' },
  { label: 'Pizza Calabresa', url: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=700&q=80' },
  { label: 'Batata Rústica', url: 'https://images.unsplash.com/photo-1576107232684-1279f3908594?auto=format&fit=crop&w=700&q=80' },
  { label: 'Coxinha / Porção', url: 'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?auto=format&fit=crop&w=700&q=80' },
  { label: 'Refrigerante', url: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=700&q=80' },
  { label: 'Suco Natural', url: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=700&q=80' },
  { label: 'Sobremesa / Cheesecake', url: 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?auto=format&fit=crop&w=700&q=80' },
];

export const MenuManagement: React.FC = () => {
  const [items, setItems] = useState<MenuItem[]>(() => store.getMenuItems());
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('TODAS');

  // Modal create/edit state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string } | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Hambúrgueres Artesanais');
  const [price, setPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [prepTimeMinutes, setPrepTimeMinutes] = useState('20');
  const [imageUrl, setImageUrl] = useState('');
  const [featured, setFeatured] = useState(false);
  const [tagsInput, setTagsInput] = useState('');
  
  // Addons list in form
  const [addons, setAddons] = useState<MenuItemAddon[]>([]);
  const [newAddonName, setNewAddonName] = useState('');
  const [newAddonPrice, setNewAddonPrice] = useState('');

  const reload = () => {
    setItems(store.getMenuItems());
  };

  const handleToggleAvailable = (item: MenuItem) => {
    const updated = { ...item, available: !item.available };
    store.saveMenuItem(updated);
    reload();
  };

  const handleOpenCreate = () => {
    setEditingItem(null);
    setName('');
    setDescription('');
    setCategory('Hambúrgueres Artesanais');
    setPrice('');
    setCostPrice('');
    setPrepTimeMinutes('20');
    setImageUrl(PRESET_IMAGES[0].url);
    setFeatured(false);
    setTagsInput('Mais Vendido');
    setAddons([]);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: MenuItem) => {
    setEditingItem(item);
    setName(item.name);
    setDescription(item.description);
    setCategory(item.category);
    setPrice(String(item.price));
    setCostPrice(item.costPrice ? String(item.costPrice) : '');
    setPrepTimeMinutes(String(item.prepTimeMinutes));
    setImageUrl(item.imageUrl);
    setFeatured(!!item.featured);
    setTagsInput(item.tags?.join(', ') || '');
    setAddons(item.addons ? [...item.addons] : []);
    setIsModalOpen(true);
  };

  const handleDelete = (id: string, itemName: string) => {
    setItemToDelete({ id, name: itemName });
  };

  const executeDeleteItem = () => {
    if (!itemToDelete) return;
    store.deleteMenuItem(itemToDelete.id);
    setItemToDelete(null);
    reload();
  };

  const handleAddAddon = () => {
    if (!newAddonName.trim() || !newAddonPrice) return;
    const newAddon: MenuItemAddon = {
      id: `ad-${Date.now()}`,
      name: newAddonName.trim(),
      price: parseFloat(newAddonPrice) || 0,
    };
    setAddons([...addons, newAddon]);
    setNewAddonName('');
    setNewAddonPrice('');
  };

  const handleRemoveAddon = (addonId: string) => {
    setAddons(addons.filter((a) => a.id !== addonId));
  };

  const handleSaveItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !price) return;

    const parsedPrice = parseFloat(price);
    const parsedCost = costPrice ? parseFloat(costPrice) : parsedPrice * 0.4;
    const parsedPrep = parseInt(prepTimeMinutes, 10) || 15;

    const tagsArray = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const savedItem: MenuItem = {
      id: editingItem ? editingItem.id : `menu-${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      category: category.trim(),
      price: parsedPrice,
      costPrice: parsedCost,
      prepTimeMinutes: parsedPrep,
      imageUrl: imageUrl.trim() || PRESET_IMAGES[0].url,
      available: editingItem ? editingItem.available : true,
      featured,
      tags: tagsArray,
      addons,
    };

    store.saveMenuItem(savedItem);
    setIsModalOpen(false);
    reload();
  };

  // Categories list
  const categories = ['TODAS', ...Array.from(new Set(items.map((i) => i.category)))];

  const filtered = items.filter((item) => {
    if (categoryFilter !== 'TODAS' && item.category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Action & Filter Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3 flex-1 min-w-[280px]">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por prato no cardápio..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium"
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition shadow-sm cursor-pointer"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>Novo Prato / Item</span>
        </button>
      </div>

      {/* Grid of Menu Items */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((item) => (
          <div
            key={item.id}
            className={`bg-white rounded-2xl border p-4 shadow-xs flex flex-col justify-between transition ${
              item.available ? 'border-slate-200' : 'border-slate-200 opacity-60 bg-slate-50'
            }`}
          >
            <div>
              <div className="flex gap-3">
                <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 shrink-0">
                  <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between">
                    <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">
                      {item.category}
                    </span>
                    <button
                      onClick={() => handleToggleAvailable(item)}
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold border transition ${
                        item.available
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}
                    >
                      {item.available ? 'Disponível' : 'Pausado'}
                    </button>
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm mt-0.5 line-clamp-1">{item.name}</h4>
                  <p className="text-xs text-slate-500 line-clamp-2 mt-1 leading-relaxed">{item.description}</p>
                </div>
              </div>

              {item.addons && item.addons.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                  <strong>Adicionais ({item.addons.length}):</strong> {item.addons.map((a) => a.name).join(', ')}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100">
              <div>
                <span className="text-base font-extrabold text-slate-900">{formatCurrency(item.price)}</span>
                <span className="text-[11px] text-slate-400 ml-2">~{item.prepTimeMinutes}min</span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleOpenEdit(item)}
                  className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
                  title="Editar prato"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(item.id, item.name)}
                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                  title="Excluir prato"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* CREATE / EDIT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-6 space-y-4 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                {editingItem ? 'Editar Prato do Cardápio' : 'Cadastrar Novo Prato'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-800 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Nome do Prato *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Burger Artesanal Trufado"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Descrição dos Ingredientes</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descreva carne, molhos, pão e acompanhamentos..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Categoria *</label>
                  <input
                    type="text"
                    required
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Hambúrgueres, Pizzas, Bebidas..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Tempo de Preparo (min)</label>
                  <input
                    type="number"
                    value={prepTimeMinutes}
                    onChange={(e) => setPrepTimeMinutes(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Preço de Venda (R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="34.90"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Custo Estimado (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    placeholder="12.00"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              {/* Image URL & Presets */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">URL da Imagem</label>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl mb-1.5"
                />
                <span className="text-[10px] text-slate-400 block mb-1">Ou escolha uma foto de demonstração rápida:</span>
                <div className="flex flex-wrap gap-1">
                  {PRESET_IMAGES.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setImageUrl(p.url)}
                      className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded text-[10px] text-slate-600"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags & Featured */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Tags (separadas por vírgula)</label>
                  <input
                    type="text"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="Mais Vendido, Sem Glúten"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={featured}
                      onChange={(e) => setFeatured(e.target.checked)}
                      className="w-4 h-4 text-amber-500 rounded"
                    />
                    <span className="font-semibold text-slate-800">Destaque do Cardápio</span>
                  </label>
                </div>
              </div>

              {/* Addons Manager */}
              <div className="pt-2 border-t border-slate-100">
                <span className="font-semibold text-slate-800 block mb-1.5">
                  Opcionais / Adicionais configurados ({addons.length}):
                </span>
                <div className="space-y-1 mb-2">
                  {addons.map((a) => (
                    <div key={a.id} className="flex justify-between items-center bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                      <span>{a.name} - {formatCurrency(a.price)}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAddon(a.id)}
                        className="text-rose-500 hover:text-rose-700"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newAddonName}
                    onChange={(e) => setNewAddonName(e.target.value)}
                    placeholder="Nome adicional (ex: Bacon Extra)"
                    className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={newAddonPrice}
                    onChange={(e) => setNewAddonPrice(e.target.value)}
                    placeholder="Preço (R$)"
                    className="w-24 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={handleAddAddon}
                    className="px-3 py-1.5 bg-slate-800 text-white rounded-xl font-bold"
                  >
                    + Adicionar
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl"
                >
                  Salvar Prato
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* CONFIRM MODAL FOR DELETE MENU ITEM */}
      {itemToDelete && (
        <ConfirmModal
          isOpen={true}
          title="Excluir Prato do Cardápio"
          message={`Deseja realmente excluir "${itemToDelete.name}" do cardápio? Este item deixará de aparecer para os clientes realizarem pedidos.`}
          confirmLabel="Excluir Prato"
          cancelLabel="Cancelar"
          isDanger={true}
          onConfirm={executeDeleteItem}
          onCancel={() => setItemToDelete(null)}
        />
      )}
    </div>
  );
};
