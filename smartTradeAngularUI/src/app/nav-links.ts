export interface NavLink {
  label: string;
  route: string;
  icon?: string; // our switch key
  badge?: string | number;
}

export const NAV_LINKS: NavLink[] = [
  { label: 'Dashboard', route: '/dashboard', icon: 'layout-dashboard' },
  {
    label: 'Front Running',
    route: '/real-time-monitoring',
    icon: 'search',
  },
  {
    label: 'Wash / Cross Trades',
    route: '/wash-trade-alerts',
    icon: 'alarm-clock',
  },
  { label: 'Layering', route: '/pump-and-dumpV2', icon: 'hammer' },
  { label: 'Spoofing', route: '/data-integration', icon: 'database' },
  { label: 'Churning', route: '/compliance-assurance', icon: 'shield' },
  {
    label: 'Open/Close Analytics',
    route: '/advanced-analytics',
    icon: 'bar-chart-3',
  },
  { label: 'Pump & Dump', route: '/pump-and-dump', icon: 'trending-up' },
  { label: 'Insider Trading', route: '/insider-trading', icon: 'user' },
  {
    label: 'Admin & Settings',
    route: '/admin-settings',
    icon: 'settings',
  },
];
