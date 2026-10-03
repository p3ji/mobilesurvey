import { useState, useEffect, useCallback, useMemo } from 'react';

export interface CartVariableItem {
  id: string; // Composite key: `${surveyGroup}:${variableName}:${lang}`
  variableName: string;
  surveyGroup: string;
  surveyAcronym?: string | null;
  year?: number | null;
  lang?: string;
  label: string;
  question?: string;
  universe?: string;
  note?: string;
  codes?: Array<{ c: string; l: string }>;
  role?: string;
  isHarmonized?: boolean;
  isGrouped?: boolean;
  isSelectAll?: boolean;
  userNotes?: string;
  addedAt: number;
}

export const DATA_CART_STORAGE_KEY = 'mobilesurvey_data_cart_v1';
export const CART_CHANGE_EVENT = 'mobilesurvey:cart-change';

export function readStoredCart(): CartVariableItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DATA_CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    console.warn('Failed to parse Data Cart from localStorage:', err);
  }
  return [];
}

export function writeStoredCart(items: CartVariableItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DATA_CART_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(CART_CHANGE_EVENT));
  } catch (err) {
    console.error('Failed to save Data Cart to localStorage:', err);
  }
}

export function makeCartItemId(surveyGroup: string, variableName: string, lang = 'en'): string {
  return `${surveyGroup.trim().toUpperCase()}:${variableName.trim().toUpperCase()}:${lang.trim().toLowerCase()}`;
}

export function parseDataCartJson(jsonString: string): { success: boolean; items: CartVariableItem[]; added: number; error?: string } {
  try {
    const parsed = JSON.parse(jsonString);
    const incoming: CartVariableItem[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.items)
        ? parsed.items
        : [];

    if (!Array.isArray(incoming)) {
      return { success: false, items: [], added: 0, error: 'Invalid cart format: expected an array of items or an object with an items array.' };
    }

    const validItems: CartVariableItem[] = [];
    for (const item of incoming) {
      if (item && item.variableName && item.surveyGroup) {
        const id = item.id || makeCartItemId(item.surveyGroup, item.variableName, item.lang || 'en');
        validItems.push({
          ...item,
          id,
          addedAt: item.addedAt || Date.now(),
        });
      }
    }

    return { success: true, items: validItems, added: validItems.length };
  } catch (err) {
    return {
      success: false,
      items: [],
      added: 0,
      error: err instanceof Error ? err.message : 'JSON parse failure',
    };
  }
}

export function exportDataCartJson(items: CartVariableItem[]): string {
  const payload = {
    app: 'mobilesurvey',
    version: 1,
    exportedAt: new Date().toISOString(),
    itemCount: items.length,
    items,
  };
  return JSON.stringify(payload, null, 2);
}

export function exportDataCartCsv(items: CartVariableItem[]): string {
  const headers = [
    'Variable Name',
    'Survey Program',
    'Survey Acronym',
    'Cycle Year',
    'Language',
    'Concept / Label',
    'Question Text',
    'Universe',
    'Note',
    'GSIM Role',
    'Is Harmonized',
    'Is Grouped PUMF',
    'Is Multi-Select',
    'Categories (Code: Label)',
    'User Notes',
    'Added At',
  ];

  const escapeCsv = (val: unknown): string => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = items.map(item => {
    const codeList = (item.codes || [])
      .map(c => `${c.c}: ${c.l}`)
      .join('; ');

    return [
      escapeCsv(item.variableName),
      escapeCsv(item.surveyGroup),
      escapeCsv(item.surveyAcronym ?? ''),
      escapeCsv(item.year ?? ''),
      escapeCsv(item.lang ?? 'en'),
      escapeCsv(item.label),
      escapeCsv(item.question ?? ''),
      escapeCsv(item.universe ?? ''),
      escapeCsv(item.note ?? ''),
      escapeCsv(item.role ?? ''),
      escapeCsv(item.isHarmonized ? 'Yes' : 'No'),
      escapeCsv(item.isGrouped ? 'Yes' : 'No'),
      escapeCsv(item.isSelectAll ? 'Yes' : 'No'),
      escapeCsv(codeList),
      escapeCsv(item.userNotes ?? ''),
      escapeCsv(new Date(item.addedAt).toISOString()),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

export function formatVariableNamesList(
  items: CartVariableItem[],
  format: 'comma' | 'space' | 'newline' | 'r' | 'stata' | 'sas' = 'comma'
): string {
  const names = [...new Set(items.map(item => item.variableName))];
  if (names.length === 0) return '';

  switch (format) {
    case 'comma':
      return names.join(', ');
    case 'space':
      return names.join(' ');
    case 'newline':
      return names.join('\n');
    case 'r':
      return `c(${names.map(n => `"${n}"`).join(', ')})`;
    case 'stata':
      return `keep ${names.join(' ')}`;
    case 'sas':
      return `keep ${names.join(' ')};`;
    default:
      return names.join(', ');
  }
}

export function computeSurveySummary(items: CartVariableItem[]) {
  const surveyMap = new Map<string, Set<number | string>>();
  for (const item of items) {
    const prog = item.surveyAcronym || item.surveyGroup;
    if (!surveyMap.has(prog)) {
      surveyMap.set(prog, new Set());
    }
    if (item.year) {
      surveyMap.get(prog)!.add(item.year);
    }
  }
  let totalCycles = 0;
  surveyMap.forEach(cycles => {
    totalCycles += Math.max(1, cycles.size);
  });
  return {
    distinctSurveys: surveyMap.size,
    distinctCycles: totalCycles,
  };
}

export function useDataCart() {
  const [items, setItems] = useState<CartVariableItem[]>(() => readStoredCart());

  // Listen to storage events across tabs and custom events within this window
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === DATA_CART_STORAGE_KEY) {
        setItems(readStoredCart());
      }
    };
    const handleLocalChange = () => {
      setItems(readStoredCart());
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener(CART_CHANGE_EVENT, handleLocalChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(CART_CHANGE_EVENT, handleLocalChange);
    };
  }, []);

  const hasItem = useCallback(
    (id: string) => items.some(item => item.id === id),
    [items]
  );

  const addItem = useCallback((itemData: Omit<CartVariableItem, 'addedAt'>) => {
    setItems(prev => {
      if (prev.some(item => item.id === itemData.id)) {
        return prev;
      }
      const newItem: CartVariableItem = {
        ...itemData,
        addedAt: Date.now(),
      };
      const updated = [newItem, ...prev];
      writeStoredCart(updated);
      return updated;
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems(prev => {
      const updated = prev.filter(item => item.id !== id);
      writeStoredCart(updated);
      return updated;
    });
  }, []);

  const toggleItem = useCallback(
    (itemData: Omit<CartVariableItem, 'addedAt'>): boolean => {
      const exists = items.some(item => item.id === itemData.id);
      if (exists) {
        removeItem(itemData.id);
        return false;
      } else {
        addItem(itemData);
        return true;
      }
    },
    [items, addItem, removeItem]
  );

  const updateNotes = useCallback((id: string, userNotes: string) => {
    setItems(prev => {
      const updated = prev.map(item =>
        item.id === id ? { ...item, userNotes } : item
      );
      writeStoredCart(updated);
      return updated;
    });
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    writeStoredCart([]);
  }, []);

  const importCart = useCallback(
    (jsonString: string): { success: boolean; added: number; error?: string } => {
      const parsed = parseDataCartJson(jsonString);
      if (!parsed.success) {
        return { success: false, added: 0, error: parsed.error };
      }

      let addedCount = 0;
      setItems(prev => {
        const map = new Map<string, CartVariableItem>();
        for (const item of prev) {
          map.set(item.id, item);
        }
        for (const item of parsed.items) {
          if (!map.has(item.id)) {
            addedCount++;
          }
          map.set(item.id, item);
        }
        const updated = Array.from(map.values()).sort((a, b) => b.addedAt - a.addedAt);
        writeStoredCart(updated);
        return updated;
      });

      return { success: true, added: addedCount };
    },
    []
  );

  const exportJson = useCallback((): string => {
    return exportDataCartJson(items);
  }, [items]);

  const exportCsv = useCallback((): string => {
    return exportDataCartCsv(items);
  }, [items]);

  const getVariableNames = useCallback(
    (format: 'comma' | 'space' | 'newline' | 'r' | 'stata' | 'sas' = 'comma'): string => {
      return formatVariableNamesList(items, format);
    },
    [items]
  );

  const surveySummary = useMemo(() => {
    return computeSurveySummary(items);
  }, [items]);

  return {
    items,
    count: items.length,
    hasItem,
    addItem,
    removeItem,
    toggleItem,
    updateNotes,
    clearCart,
    importCart,
    exportJson,
    exportCsv,
    getVariableNames,
    surveySummary,
  };
}
