/**
 * Previously restricted admin to desktop and hid it on mobile.
 * All routes now render on every viewport size.
 */
export default function DesktopAdminOnlyGuard({ children }) {
  return children;
}
