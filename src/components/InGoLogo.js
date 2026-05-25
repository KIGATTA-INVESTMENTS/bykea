import { INGO_LOGO_URL } from '../lib/ingoLogo';
import './InGoLogo.css';

/**
 * @param {{
 *   variant?: 'splash' | 'hero' | 'nav' | 'auth' | 'admin' | 'adminSidebar' | 'driver' | 'shop' | 'shopSidebar' | 'driverBrand';
 *   className?: string;
 *   alt?: string;
 * }} props
 */
export default function InGoLogo({ variant = 'nav', className = '', alt = 'InGo' }) {
  const classes = ['ingo-logo', `ingo-logo--${variant}`, className].filter(Boolean).join(' ');
  return <img src={INGO_LOGO_URL} alt={alt} className={classes} decoding="async" />;
}

export { INGO_LOGO_URL };
