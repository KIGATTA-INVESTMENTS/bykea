import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { isDriverSignedIn } from '../../lib/driverSession';
import DriverApprovalGate from './DriverApprovalGate';
import DriverBottomNav from './DriverBottomNav';
import './DriverApp.css';

export default function DriverLayout() {
  const location = useLocation();
  if (!isDriverSignedIn()) {
    return <Navigate to="/driver/login" replace state={{ from: location.pathname }} />;
  }
  return (
    <DriverApprovalGate>
      <div className="driver-app">
        <div className="driver-app__outlet">
          <Outlet />
        </div>
        <DriverBottomNav />
      </div>
    </DriverApprovalGate>
  );
}
