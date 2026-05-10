import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AwsCredsState {
  region: string;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  sessionToken: string | null;
  usingIamRole: boolean;
  setRegion: (r: string) => void;
  setKeys: (accessKeyId: string | null, secretAccessKey: string | null, sessionToken?: string | null) => void;
  setUsingIamRole: (v: boolean) => void;
  clear: () => void;
}

export const useAwsCredsStore = create<AwsCredsState>()(
  persist(
    (set) => ({
      region: 'us-east-1',
      accessKeyId: null,
      secretAccessKey: null,
      sessionToken: null,
      usingIamRole: false,
      setRegion: (region) => set({ region }),
      setKeys: (accessKeyId, secretAccessKey, sessionToken = null) =>
        set({ accessKeyId, secretAccessKey, sessionToken, usingIamRole: false }),
      setUsingIamRole: (usingIamRole) => set({ usingIamRole }),
      clear: () => set({ accessKeyId: null, secretAccessKey: null, sessionToken: null, usingIamRole: false }),
    }),
    {
      name: 'aws-creds',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
