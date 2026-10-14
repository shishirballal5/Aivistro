import { adminRequest } from "./admin";

export type DashboardDays = 7 | 30 | 90;
export const DASHBOARD_DAYS: DashboardDays[] = [7, 30, 90];
export type DayPoint = { date: string; value: number };
export type Dashboard = {
  rangeDays: number; generatedAt: string; cached: boolean;
  totals: {
    users: number; newUsers: number; activeSubscribers: number; newSubscriptions: number; failedPayments: number;
    revenue: { grossPaise: number; refundedPaise: number; netPaise: number; netDisplay: string; payments: number };
    playbackStarts: number; uniqueViewers: number; watchHours: number;
  };
  topSeries: { id: string; title: string; playbackStarts: number; uniqueViewers: number }[];
  daily: { revenuePaise: DayPoint[]; newUsers: DayPoint[]; playbackStarts: DayPoint[] };
};
export const getDashboard = (days: DashboardDays) => adminRequest<Dashboard>("/admin/dashboard", { query: { days } });

export type SectionType = "CAROUSEL" | "FEATURED" | "COLLECTION";
export const SECTION_TYPES: SectionType[] = ["CAROUSEL", "FEATURED", "COLLECTION"];

export type AdminBanner = {
  id: string; title: string; imageKey: string; imageUrl: string | null; seriesId: string | null; linkUrl: string | null;
  active: boolean; startAt: string | null; endAt: string | null; sortOrder: number;
};
export type BannerInput = { title: string; imageKey: string; seriesId?: string; linkUrl?: string; active?: boolean; startAt?: string; endAt?: string; sortOrder?: number };
export const bannersApi = {
  list: () => adminRequest<AdminBanner[]>("/admin/banners"),
  create: (b: BannerInput) => adminRequest<AdminBanner>("/admin/banners", { method: "POST", body: b }),
  update: (id: string, b: BannerInput) => adminRequest<AdminBanner>(`/admin/banners/${id}`, { method: "PUT", body: b }),
  remove: (id: string) => adminRequest<void>(`/admin/banners/${id}`, { method: "DELETE" }),
};

export type AdminSection = { id: string; key: string; title: string; type: SectionType; sortOrder: number; active: boolean; seriesIds: string[] };
export type SectionInput = { key: string; title: string; type: SectionType; sortOrder?: number; active?: boolean; seriesIds: string[] };
export const sectionsApi = {
  list: () => adminRequest<AdminSection[]>("/admin/homepage-sections"),
  create: (s: SectionInput) => adminRequest<AdminSection>("/admin/homepage-sections", { method: "POST", body: s }),
  update: (id: string, s: SectionInput) => adminRequest<AdminSection>(`/admin/homepage-sections/${id}`, { method: "PUT", body: s }),
  remove: (id: string) => adminRequest<void>(`/admin/homepage-sections/${id}`, { method: "DELETE" }),
};

export type SeriesHit = { id: string; title: string; status: string };
export const searchSeries = (q: string) => adminRequest<{ items: SeriesHit[] }>("/admin/series", { query: { q, limit: 10 } }).then((r) => r.items);
/** All series (id -> title), following cursors; used to label ids. */
export async function allSeries(): Promise<SeriesHit[]> {
  const out: SeriesHit[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = await adminRequest<{ items: SeriesHit[]; nextCursor: string | null }>("/admin/series", { query: { limit: 50, cursor } });
    out.push(...r.items);
    if (!r.nextCursor) break;
    cursor = r.nextCursor;
  }
  return out;
}
