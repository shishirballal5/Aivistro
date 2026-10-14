import * as m0 from '../../modules/admin/admin.entities';
import * as m1 from '../../modules/analytics/analytics.entities';
import * as m2 from '../../modules/audit-logs/audit.entities';
import * as m3 from '../../modules/auth/auth.entities';
import * as m4 from '../../modules/catalog/catalog.entities';
import * as m5 from '../../modules/notifications/notifications.entities';
import * as m6 from '../../modules/playback/playback.entities';
import * as m7 from '../../modules/subscriptions/billing.entities';
import * as m8 from '../../modules/users/user.entities';
import * as m9 from '../../modules/video-assets/video-assets.entities';
import * as m10 from '../../modules/watch-history/watch-history.entities';
import * as m11 from '../../modules/watchlist/watchlist.entities';
import { SystemSetting } from './system-setting.entity';

/**
 * Every entity, registered in one place. Each table is DEFINED in the module that owns it (see the *.entities.ts file in that
 * module's folder); this barrel only collects them, so `import { User } from '../../database/entities'` keeps working everywhere.
 * Explicit (not glob-based) so builds and bundlers stay predictable.
 */
// Enums are plain objects; entity classes are functions.
const isEntity = (v: unknown): v is new () => object => typeof v === 'function';

export const entities = [SystemSetting, ...[m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11].flatMap((m) => Object.values(m).filter(isEntity))];
export * from '../../modules/admin/admin.entities';
export * from '../../modules/analytics/analytics.entities';
export * from '../../modules/audit-logs/audit.entities';
export * from '../../modules/auth/auth.entities';
export * from '../../modules/catalog/catalog.entities';
export * from '../../modules/notifications/notifications.entities';
export * from '../../modules/playback/playback.entities';
export * from '../../modules/subscriptions/billing.entities';
export * from '../../modules/users/user.entities';
export * from '../../modules/video-assets/video-assets.entities';
export * from '../../modules/watch-history/watch-history.entities';
export * from '../../modules/watchlist/watchlist.entities';
export { SystemSetting };
