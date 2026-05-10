import { create } from 'zustand';

interface MockModeStore {
  mockMode: boolean;
  setMockMode: (v: boolean) => void;
}

export const useMockModeStore = create<MockModeStore>((set) => ({
  mockMode: false,
  setMockMode: (mockMode) => set({ mockMode }),
}));
