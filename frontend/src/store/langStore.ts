import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Lang } from '../i18n/translations';

interface LangStore {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const useLangStore = create<LangStore>()(
  persist(
    (set) => ({
      lang: 'pt',
      setLang: (lang) => set({ lang }),
    }),
    { name: 'dataihub-lang' }
  )
);
