import { useLocation } from 'react-router-dom';
import { useIsDesktopViewport } from '../hooks/useIsDesktopViewport';
import './DesktopAdminOnlyGuard.css';

function isAdminPath(pathname) {
  return pathname === '/admin/login' || pathname.startsWith('/admin/') || pathname === '/admin';
}

/**
 * Desktop: only /admin routes render; other URLs show a black screen.
 * Mobile/tablet/iPad: /admin is hidden; all other routes work normally.
 */
export default function DesktopAdminOnlyGuard({ children }) {
  const isDesktop = useIsDesktopViewport();
  const { pathname } = useLocation();
  const onAdmin = isAdminPath(pathname);

  const blocked = (isDesktop && !onAdmin) || (!isDesktop && onAdmin);

  if (blocked) {
    return <div className="viewport-blocked" aria-hidden="true" />;
  }

  return children;
}
