import { viewerApi } from "./http";

const r = viewerApi.request;

/* ───────── types (mirror the backend responses) ───────── */
export type UserView = { id: string; displayName: string; phone: string | null; email: string | null; emailVerified: boolean; language: string };
export type ProfileRequired = { status: "PROFILE_REQUIRED"; profileToken: string };
export type NewProfile = { displayName: string; email: string; dateOfBirth: string };
export type AuthResponse = { accessToken: string; refreshToken: string; tokenType: "Bearer"; expiresIn: number; user: UserView };
export type Tag = { id: string; name: string; slug: string };
export type SeriesCard = { id: string; slug: string; title: string; synopsis: string; language: string; maturityRating: string; releaseYear: number | null; posterUrl: string | null; bannerUrl: string | null; featured: boolean; episodeCount: number; genres: Tag[]; categories: Tag[] };
export type SeriesDetail = SeriesCard & { cast: { id: string; name: string; roleName: string | null; photoUrl: string | null }[] };
export type Access = { allowed: boolean; code?: string; message?: string; requiresAuth?: boolean };
export type EpisodeItem = { id: string; seriesId: string; number: number; title: string; description: string | null; durationSeconds: number; thumbnailUrl: string | null; releasedAt: string | null; access: Access };
export type Page<T> = { items: T[]; nextCursor: string | null };
export type Plan = { id: string; code: string; name: string; description: string; durationMonths: number; pricePaise: number; priceDisplay: string; currency: string; active: boolean; sortOrder: number };
export type SubscriptionView = { id: string; planName: string | null; status: string; source: string; startsAt: string; endsAt: string; cancelAtPeriodEnd: boolean; cancelledAt: string | null };
export type MySubscription = { active: boolean; entitledUntil: string | null; current: SubscriptionView | null; history: SubscriptionView[] };
export type Checkout = { paymentId: string; orderId: string; keyId: string | null; amountPaise: number; amountDisplay: string; currency: string; planCode: string; planName: string; durationMonths: number };
export type Quote = { planCode: string; planName: string; durationMonths: number; listPricePaise: number; listPriceDisplay: string; creditPaise: number; creditDisplay: string; amountPaise: number; amountDisplay: string; upgrade: boolean; replaces: { planName: string | null; endsAt: string } | null };
export type PaymentProof = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
export type PlaybackSession = { sessionId: string; manifestUrl: string; expiresAt: string; heartbeatIntervalSeconds: number; episode: { id: string; number: number; title: string; durationSeconds: number }; endedOtherStreams?: number };
export type PublicConfig = { auth: { phoneOtp: boolean; emailPassword: boolean; google: { clientId: string } | null; apple: { clientId: string } | null }; payments: { gateway: "razorpay" | "dev" | "none"; keyId: string | null }; development: { devMessages: boolean; devPayments: boolean } };
export type HomeData = { banners: { id: string; title: string; imageUrl: string | null; seriesId: string | null; linkUrl: string | null }[]; sections: { key: string; title: string; type: string; items: SeriesCard[] }[] };
export type ContinueItem = { series: { id: string; slug: string; title: string; posterUrl: string | null }; episode: { id: string; number: number; title: string; durationSeconds: number }; kind: "RESUME" | "NEXT"; positionSeconds: number; durationSeconds: number; progressPercent: number; episodesCompleted: number; lastWatchedAt: string };
export type Notice = { id: string; title: string; body: string; category: string; read: boolean; createdAt: string };

/* ───────── endpoints ───────── */
export const publicApi = {
  config: () => r<PublicConfig>("/config", { auth: "none" }),
  genres: () => r<Tag[]>("/genres", { auth: "none" }),
  home: () => r<HomeData>("/home", { auth: "none" }),
  plans: () => r<Plan[]>("/plans", { auth: "none" }),
  series: (q: { cursor?: string; limit?: number; genre?: string; q?: string; sort?: string } = {}) => r<Page<SeriesCard>>("/series", { auth: "none", query: q }),
  seriesDetail: (ref: string) => r<SeriesDetail>(`/series/${encodeURIComponent(ref)}`, { auth: "none" }),
  episodes: (ref: string, cursor?: string) => r<Page<EpisodeItem>>(`/series/${encodeURIComponent(ref)}/episodes`, { auth: "optional", query: { cursor, limit: 50 } }),
  devOutbox: (to: string) => r<{ message: { kind: string; to: string; subject: string | null; body: string; at: string } | null }>("/dev/outbox", { auth: "none", query: { to } }),
};

export const authApi = {
  requestOtp: (phone: string) => r<{ expiresInSeconds: number; resendAfterSeconds: number }>("/auth/otp/request", { method: "POST", body: { phone }, auth: "none" }),
  /** New number + no profile -> { status: "PROFILE_REQUIRED" }; send the profile with the code (sign-up) or finish with completeProfile(). */
  verifyOtp: (phone: string, code: string, profile?: NewProfile) => r<AuthResponse | ProfileRequired>("/auth/otp/verify", { method: "POST", body: { phone, code, deviceName: "Web", ...profile }, auth: "none" }),
  completeProfile: (profileToken: string, profile: NewProfile) => r<AuthResponse>("/auth/otp/complete", { method: "POST", body: { profileToken, deviceName: "Web", ...profile }, auth: "none" }),
  register: (email: string, password: string, displayName: string, dateOfBirth: string) => r<{ message: string }>("/auth/register", { method: "POST", body: { email, password, displayName, dateOfBirth }, auth: "none" }),
  verifyEmail: (token: string) => r<void>("/auth/email/verify", { method: "POST", body: { token }, auth: "none" }),
  resendVerification: (email: string) => r<{ message: string }>("/auth/email/resend", { method: "POST", body: { email }, auth: "none" }),
  login: (email: string, password: string) => r<AuthResponse>("/auth/login", { method: "POST", body: { email, password, deviceName: "Web" }, auth: "none" }),
  forgotPassword: (email: string) => r<{ message: string }>("/auth/password/forgot", { method: "POST", body: { email }, auth: "none" }),
  resetPassword: (token: string, newPassword: string) => r<void>("/auth/password/reset", { method: "POST", body: { token, newPassword }, auth: "none" }),
  google: (idToken: string, dateOfBirth?: string) => r<AuthResponse>("/auth/google", { method: "POST", body: { idToken, deviceName: "Web", ...(dateOfBirth ? { dateOfBirth } : {}) }, auth: "none" }),
  logout: () => r<void>("/auth/logout", { method: "POST" }),
  me: () => r<UserView>("/me"),
  updateProfile: (p: { displayName?: string; language?: string }) => r<UserView>("/me/profile", { method: "PATCH", body: p }),
};

export const billingApi = {
  mine: () => r<MySubscription>("/subscriptions/me"),
  quote: (planCode: string) => r<Quote>("/subscriptions/quote", { method: "POST", body: { planCode } }),
  checkout: (planCode: string) => r<Checkout>("/subscriptions/checkout", { method: "POST", body: { planCode } }),
  verify: (p: PaymentProof) => r<{ status: "ACTIVE" | "PENDING" | "FAILED" | string; subscription: MySubscription }>("/subscriptions/verify", { method: "POST", body: p }),
  cancel: () => r<MySubscription>("/subscriptions/cancel", { method: "POST" }),
  /** Development gateway only: asks the server to complete a simulated payment (it signs the webhook itself). */
  devComplete: (orderId: string, outcome: "captured" | "failed" = "captured") => r<PaymentProof>(`/dev/payments/${encodeURIComponent(orderId)}/complete`, { method: "POST", body: { outcome } }),
};

export const playbackApi = {
  start: (episodeId: string) => r<PlaybackSession>(`/episodes/${episodeId}/playback-session`, { method: "POST" }),
  heartbeat: (sessionId: string, positionSeconds: number) => r<{ ok: boolean; expiresAt: string }>(`/playback-sessions/${sessionId}/heartbeat`, { method: "POST", body: { positionSeconds: Math.floor(positionSeconds) } }),
  end: (sessionId: string) => r<void>(`/playback-sessions/${sessionId}`, { method: "DELETE" }),
  saveProgress: (episodeId: string, positionSeconds: number) => r<void>(`/episodes/${episodeId}/progress`, { method: "PUT", body: { positionSeconds: Math.floor(positionSeconds) } }),
  resume: (episodeId: string) => r<{ episodeId: string; positionSeconds: number; durationSeconds: number; completed: boolean }>(`/episodes/${episodeId}/progress`),
  continueWatching: () => r<Page<ContinueItem>>("/me/continue-watching", { query: { limit: 20 } }),
};

export const listApi = {
  watchlist: () => r<Page<SeriesCard>>("/me/watchlist", { query: { limit: 50 } }),
  add: (seriesId: string) => r<{ inWatchlist: boolean }>(`/me/watchlist/${seriesId}`, { method: "PUT" }),
  remove: (seriesId: string) => r<void>(`/me/watchlist/${seriesId}`, { method: "DELETE" }),
};

export const noticeApi = {
  unread: () => r<{ unread: number }>("/me/notifications/unread-count"),
  list: () => r<Page<Notice>>("/me/notifications", { query: { limit: 20 } }),
  readAll: () => r<void>("/me/notifications/read-all", { method: "POST" }),
};

export const analyticsApi = {
  track: (type: string, extra: { entityType?: string; entityId?: string; properties?: Record<string, string | number | boolean> } = {}) =>
    r<void>("/analytics/events", { method: "POST", auth: "optional", body: { events: [{ type, ...extra }] } }).catch(() => undefined),
};
