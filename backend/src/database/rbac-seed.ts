/** Reference data for role-based access control. Shared by the seed migration and the tests. */
export const PERMISSIONS: Record<string, string> = {
  'catalog.read': 'View series, episodes and metadata in the admin',
  'catalog.write': 'Create and edit series, episodes, genres, categories and cast',
  'catalog.publish': 'Publish, schedule, unpublish and archive content',
  'homepage.write': 'Manage homepage sections and banners',
  'video.manage': 'Upload videos and manage processing',
  'users.read': 'View viewer accounts',
  'users.manage': 'Suspend, restore and support viewer accounts',
  'subscriptions.read': 'View subscriptions and entitlements',
  'plans.manage': 'Create and edit subscription plans and prices',
  'payments.read': 'View payments and webhook events',
  'payments.refund': 'Issue refunds',
  'notifications.send': 'Create and send notification campaigns',
  'analytics.read': 'View dashboards and analytics',
  'admins.manage': 'Create, disable and assign roles to admin users',
  'roles.manage': 'Create roles and change their permissions',
  'audit.read': 'View the audit log',
  'settings.manage': 'Change platform settings',
};

export const SYSTEM_ROLES: Record<string, { description: string; permissions: string[] | 'ALL' }> = {
  SUPER_ADMIN: { description: 'Full access', permissions: 'ALL' },
  EDITOR: { description: 'Manages content and video', permissions: ['catalog.read', 'catalog.write', 'catalog.publish', 'homepage.write', 'video.manage', 'analytics.read'] },
  SUPPORT: { description: 'Helps viewers', permissions: ['users.read', 'users.manage', 'subscriptions.read', 'payments.read'] },
  FINANCE: { description: 'Plans, payments and refunds', permissions: ['payments.read', 'payments.refund', 'subscriptions.read', 'plans.manage', 'analytics.read'] },
};
