const mem = new Map<string, string>();
export const getItemAsync = async (k: string) => mem.get(k) ?? null;
export const setItemAsync = async (k: string, v: string) => void mem.set(k, v);
export const deleteItemAsync = async (k: string) => void mem.delete(k);
