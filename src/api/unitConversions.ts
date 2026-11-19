import { api } from './client';

export type UnitConversion = {
  id: string;
  itemName: string;
  baseUnit: string;
  targetUnit: string;
  ratio: number;
};

export const unitConversionsApi = {
  upsert: async (input: {
    itemName: string;
    baseUnit: string;
    targetUnit: string;
    ratio: number;
  }): Promise<UnitConversion | null> => {
    const response = await api.post<UnitConversion>('unit-conversions', input);
    if (!response.success || !response.data) return null;
    return response.data;
  },
};
