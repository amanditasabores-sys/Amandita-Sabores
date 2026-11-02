import React, { useMemo } from 'react';
import { store } from '../../../services/store';
import { MenuItem } from '../../../types';
import { Tag, Package, CheckCircle2, AlertCircle } from 'lucide-react';

export const CategoryListTab: React.FC = () => {
  const items = store.getMenuItems();

  const categoryStats = useMemo(() => {
    const map = new Map<string, { total: number; available: number; unavailable: number; avgPrice: number; sampleImage: string }>();

    items.forEach((item) => {
      const cat = item.category || 'Geral';
      const current = map.get(cat) || { total: 0, available: 0, unavailable: 0, avgPrice: 0, sampleImage: item.imageUrl };
      current.total += 1;
      if (item.available !== false) current.available += 1;
      else current.unavailable += 1;
      current.avgPrice += item.price;
      if (!current.sampleImage && item.imageUrl) current.sampleImage = item.imageUrl;
      map.set(cat, current);
    });

    return Array.from(map.entries()).map(([name, stat]) => ({
      name,
      total: stat.total,
      available: stat.available,
      unavailable: stat.unavailable,
      avgPrice: stat.total > 0 ? stat.avgPrice / stat.total : 0,
      sampleImage: stat.sampleImage,
    }));
  }, [items]);

  return (
    <div className="space-y-5">
      <div className="bg-[#FFFDF9] rounded-2xl p-4 sm:p-5 border border-[#E8DFD5] shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-gradient-to-br from-[#C86D3B] to-[#721C24] text-white rounded-xl shadow-xs">
            <Tag className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-black text-[#2C1810]">Categorias do Cardápio</h3>
            <p className="text-xs text-[#8C5E47]">
              Organização automática baseada nos produtos cadastrados ({categoryStats.length} categorias ativas).
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {categoryStats.map((cat) => (
          <div
            key={cat.name}
            className="bg-[#FFFDF9] rounded-2xl border border-[#E8DFD5] p-4 shadow-xs flex items-center justify-between gap-3 hover:border-[#C86D3B]/40 transition"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-slate-100 overflow-hidden shrink-0">
                <img
                  src={cat.sampleImage}
                  alt={cat.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <h4 className="font-black text-sm text-[#2C1810] truncate">{cat.name}</h4>
                <p className="text-xs text-[#8C5E47] mt-0.5">
                  {cat.total} {cat.total === 1 ? 'produto' : 'produtos'}
                </p>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md block">
                {cat.available} ativos
              </span>
              {cat.unavailable > 0 && (
                <span className="text-[10px] text-rose-600 mt-1 block">
                  {cat.unavailable} esgotados
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
