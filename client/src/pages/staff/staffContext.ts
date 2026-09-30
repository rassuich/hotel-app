import { createContext, useContext } from 'react';
import type { StaffMeDto } from '../../../../shared/src/api';

export const StaffCtx = createContext<{ me: StaffMeDto; reload: () => Promise<void>; signOut: () => Promise<void> } | null>(null);

export function useStaff() {
  const v = useContext(StaffCtx);
  if (!v) throw new Error('StaffCtx missing');
  return v;
}
