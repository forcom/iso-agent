import { createContext, useContext, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export type WorkspaceTab = { id: string; to: string; label: string; paths?: string[] };
export const WorkspaceTabContext = createContext<((tab: WorkspaceTab) => void) | null>(null);

export function useWorkspaceTab(id?: string, label?: string, paths?: string[]) {
  const register = useContext(WorkspaceTabContext);
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (id && label) register?.({ id, label, to: pathname + search, paths });
  }, [id, label, pathname, search, paths, register]);
}
