import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const AdminHeaderActionsContext = createContext(null);

export function AdminHeaderActionsProvider({ children }) {
  const [actions, setActions] = useState(null);
  const registerActions = useCallback((node) => setActions(node), []);
  const clearActions = useCallback(() => setActions(null), []);

  const value = useMemo(
    () => ({ actions, registerActions, clearActions }),
    [actions, registerActions, clearActions],
  );

  return <AdminHeaderActionsContext.Provider value={value}>{children}</AdminHeaderActionsContext.Provider>;
}

export function useAdminHeaderActions() {
  return useContext(AdminHeaderActionsContext);
}

/**
 * Mount page-specific header buttons (Refresh, Export, etc.) into the global admin top bar.
 * @param {import('react').ReactNode} node
 * @param {unknown[]} deps
 */
export function useSetAdminHeaderActions(node, deps = []) {
  const ctx = useAdminHeaderActions();
  useEffect(() => {
    if (!ctx) return undefined;
    ctx.registerActions(node);
    return () => ctx.clearActions();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls deps
  }, [ctx, node, ...deps]);
}

/** Solid orange Refresh for the global admin top bar */
export function AdminHeaderRefresh({ onClick, disabled }) {
  return (
    <button
      type="button"
      className="admHeaderBtn admHeaderBtn--solid"
      onClick={onClick}
      disabled={disabled}
    >
      Refresh
    </button>
  );
}

/** White outlined secondary action for the global admin top bar */
export function AdminHeaderOutlineBtn({ children, onClick, disabled, type = 'button' }) {
  return (
    <button
      type={type}
      className="admHeaderBtn admHeaderBtn--outline"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
