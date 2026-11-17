import * as React from 'react';
import { useLayoutPreference } from '@/store/useLayoutPreference';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const preference = useLayoutPreference((s) => s.preference);
  const [viewportMobile, setViewportMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setViewportMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener('change', onChange);
    setViewportMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  if (preference === 'mobile') return true;
  if (preference === 'desktop') return false;
  return !!viewportMobile;
}