import { adminRequest } from "./admin";
import { ApiError } from "./http";

export type ContentStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
export type TransitionAction = "publish" | "schedule" | "unpublish" | "archive" | "restore";
export type VideoStatus = "UPLOADING" | "UPLOADED" | "PROCESSING" | "READY" | "FAILED";

export type Named = { id: string; name: string; slug: string };
export type CastMember = { id: string; name: string; bio: string | null; photoKey: string | null };
export type CastLink = { castMemberId: string; roleName?: string | null; billingOrder?: number; name?: string };

export type SeriesRow = {
  id: string; slug: string; title: string; synopsis: string; language: string; maturityRating: string; releaseYear: number | null;
  posterKey: string | null; posterUrl: string | null; bannerKey: string | null; bannerUrl: string | null; status: ContentStatus; publishAt: string | null; publishedAt: string | null;
  sortWeight: number; isFeatured: boolean; createdAt: string; updatedAt: string;
};
export type SeriesDetail = SeriesRow & { genres: Named[]; categories: Named[]; cast: CastLink[] };
export type SeriesInput = {
  title: string; synopsis: string; language?: string; maturityRating?: string; releaseYear?: number; posterKey?: string | null; bannerKey?: string | null;
  sortWeight?: number; isFeatured?: boolean; genreIds?: string[]; categoryIds?: string[]; cast?: { castMemberId: string; roleName?: string; billingOrder?: number }[];
};
export type EpisodeRow = {
  id: string; seriesId: string; number: number; title: string; description: string | null; durationSeconds: number; thumbnailKey: string | null; thumbnailUrl: string | null;
  status: ContentStatus; publishAt: string | null; publishedAt: string | null; hasVideo: boolean; createdAt: string;
};
export type Variant = { name: string; width: number; height: number; bandwidth: number };
export type VideoAssetRow = {
  id: string; episodeId: string; status: VideoStatus; filename: string; contentType: string; sizeBytes: number | null; durationSeconds: number | null;
  width: number | null; height: number | null; variants: Variant[]; failureReason: string | null; processingAttempts: number; processedAt: string | null; createdAt: string;
  current?: boolean; subtitles?: { language: string; label: string }[];
};
export type UploadTicket = { assetId: string; upload: { url: string; method: string; headers: Record<string, string>; expiresAt: string }; maxBytes: number };

export const LANGUAGES: [string, string][] = [["hi", "Hindi"], ["en", "English"], ["ta", "Tamil"], ["te", "Telugu"], ["bn", "Bengali"], ["mr", "Marathi"]];
export const RATINGS = ["U", "7+", "13+", "16+", "18+"];
/** Mirrors IMAGE_KEY in backend/src/modules/catalog/catalog.util.ts */
export const IMAGE_KEY = /^images\/(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9/_.-]{0,200}$/;

export const catalogApi = {
  listSeries: (q: { q?: string; status?: string; cursor?: string | null; limit?: number }) =>
    adminRequest<{ items: SeriesRow[]; nextCursor: string | null }>("/admin/series", { query: { q: q.q, status: q.status, cursor: q.cursor, limit: q.limit ?? 20 } }),
  getSeries: (id: string) => adminRequest<SeriesDetail>(`/admin/series/${id}`),
  createSeries: (body: SeriesInput) => adminRequest<SeriesDetail>("/admin/series", { method: "POST", body }),
  updateSeries: (id: string, body: Partial<SeriesInput>) => adminRequest<SeriesDetail>(`/admin/series/${id}`, { method: "PATCH", body }),
  deleteSeries: (id: string) => adminRequest<void>(`/admin/series/${id}`, { method: "DELETE" }),
  genres: () => adminRequest<Named[]>("/genres", { auth: "none" }), // no admin list endpoint: the public list is complete
  categories: () => adminRequest<Named[]>("/categories", { auth: "none" }),
  createGenre: (name: string) => adminRequest<Named>("/admin/genres", { method: "POST", body: { name } }),
  createCategory: (name: string) => adminRequest<Named>("/admin/categories", { method: "POST", body: { name } }),
  cast: () => adminRequest<CastMember[]>("/admin/cast"),
  createCast: (name: string) => adminRequest<CastMember>("/admin/cast", { method: "POST", body: { name } }),
  listEpisodes: (seriesId: string) => adminRequest<EpisodeRow[]>(`/admin/series/${seriesId}/episodes`),
  createEpisode: (seriesId: string, body: { number?: number; title: string; description?: string; thumbnailKey?: string | null }) => adminRequest<EpisodeRow>(`/admin/series/${seriesId}/episodes`, { method: "POST", body }),
  updateEpisode: (id: string, body: { number?: number; title?: string; description?: string; thumbnailKey?: string | null }) => adminRequest<EpisodeRow>(`/admin/episodes/${id}`, { method: "PATCH", body }),
  /** One atomic request: episode numbers become 1..n in this order. The list must contain every episode of the series exactly once. */
  reorderEpisodes: (seriesId: string, episodeIds: string[]) => adminRequest<EpisodeRow[]>(`/admin/series/${seriesId}/episodes/reorder`, { method: "POST", body: { episodeIds } }),
  deleteEpisode: (id: string) => adminRequest<void>(`/admin/episodes/${id}`, { method: "DELETE" }),
  transition: <T = SeriesRow | EpisodeRow>(kind: "series" | "episodes", id: string, action: TransitionAction, publishAt?: string) =>
    adminRequest<T>(`/admin/${kind}/${id}/${action}`, { method: "POST", body: action === "schedule" ? { publishAt } : undefined }),
};

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export type ImageTicket = { key: string; upload: { url: string; method: string; headers: Record<string, string>; expiresAt: string }; maxBytes: number };
export const imageApi = {
  request: (body: { filename: string; contentType: string; sizeBytes: number }) => adminRequest<ImageTicket>("/admin/images", { method: "POST", body }),
  complete: (key: string) => adminRequest<{ key: string; url: string | null }>("/admin/images/complete", { method: "POST", body: { key } }),
};
/** Same checks as the server's RequestImageUploadDto, so most mistakes are caught before any request. Returns an error message or null. */
export const imageFileProblem = (f: File): string | null =>
  !(IMAGE_TYPES as readonly string[]).includes(f.type) ? "Use a JPEG, PNG or WebP image (SVG and GIF are not allowed)."
    : f.size < 1 ? "That file is empty." : f.size > MAX_IMAGE_BYTES ? `That image is ${(f.size / 1048576).toFixed(1)} MB; the limit is 5 MB.` : !/^[A-Za-z0-9][A-Za-z0-9 _.()-]*\.(jpe?g|png|webp)$/i.test(f.name) || f.name.includes("..") ? "Rename the file to a plain name (letters, digits, spaces, _ . ( ) -) ending in .jpg, .png or .webp." : null;

/** PUT the file to the signed upload URL with real progress (fetch cannot report upload progress). */
function putWithProgress(t: ImageTicket["upload"], file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(t.method, t.url);
    Object.entries(t.headers).forEach(([k, v]) => x.setRequestHeader(k, v));
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return resolve();
      let msg = x.status === 403 ? "The upload link was rejected or has expired. Please try again." : `The upload was rejected (HTTP ${x.status}).`;
      try { const b = JSON.parse(x.responseText) as { message?: string }; if (b.message) msg = b.message; } catch { /* S3 answers in XML */ }
      reject(new Error(msg));
    };
    x.onerror = () => reject(new Error("The upload failed: couldn't reach the storage server. Check your connection and try again."));
    x.onabort = () => reject(new Error("Upload cancelled."));
    x.send(file);
  });
}
/** request -> PUT (with progress) -> complete. Resolves with the verified key and the server-derived public URL. */
export async function uploadImage(file: File, onProgress: (p: number) => void): Promise<{ key: string; url: string | null }> {
  const t = await imageApi.request({ filename: file.name, contentType: file.type, sizeBytes: file.size });
  await putWithProgress(t.upload, file, onProgress);
  return imageApi.complete(t.key);
}

export const videoApi = {
  list: (episodeId: string) => adminRequest<VideoAssetRow[]>(`/admin/episodes/${episodeId}/video-assets`),
  get: (assetId: string) => adminRequest<VideoAssetRow>(`/admin/video-assets/${assetId}`),
  request: (episodeId: string, body: { filename: string; contentType: string; sizeBytes: number }) => adminRequest<UploadTicket>(`/admin/episodes/${episodeId}/video-assets`, { method: "POST", body }),
  complete: (assetId: string) => adminRequest<VideoAssetRow>(`/admin/video-assets/${assetId}/complete`, { method: "POST" }),
  reprocess: (assetId: string) => adminRequest<VideoAssetRow>(`/admin/video-assets/${assetId}/reprocess`, { method: "POST" }),
  addSubtitle: (assetId: string, body: { language: string; label: string; vtt: string }) => adminRequest<unknown>(`/admin/video-assets/${assetId}/subtitles`, { method: "POST", body }),
  removeSubtitle: (assetId: string, language: string) => adminRequest<void>(`/admin/video-assets/${assetId}/subtitles/${encodeURIComponent(language)}`, { method: "DELETE" }),
};

/** Which lifecycle actions the server's state machine allows from a status. */
export const actionsFor = (s: ContentStatus): TransitionAction[] =>
  s === "DRAFT" ? ["publish", "schedule", "archive"] : s === "SCHEDULED" ? ["publish", "unpublish", "archive"] : s === "PUBLISHED" ? ["unpublish", "archive"] : ["restore"];

export const statusLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
export const statusTone = (s: string) => (s === "PUBLISHED" || s === "READY" ? "green" : s === "SCHEDULED" || s === "PROCESSING" || s === "UPLOADED" || s === "UPLOADING" ? "amber" : s === "FAILED" ? "red" : "grey") as "green" | "amber" | "red" | "grey";

/** PUBLISH_VALIDATION_FAILED carries the list of unmet rules in `details`. */
export const publishProblems = (e: unknown): string[] | null =>
  e instanceof ApiError && e.code === "PUBLISH_VALIDATION_FAILED" ? (Array.isArray(e.details) ? e.details.map(String) : [e.message]) : null;

export const failMessage = (e: unknown) => (e instanceof ApiError && e.status === 403 ? "You don't have permission to do that." : e instanceof Error ? e.message : "Something went wrong. Please try again.");

/** The public media base is implied by any posterUrl: strip the (encoded) key to get it. */
export const mediaBaseFrom = (url: string | null, key: string | null) => {
  if (!url || !key) return null;
  const enc = key.split("/").map(encodeURIComponent).join("/");
  return url.endsWith(enc) ? url.slice(0, url.length - enc.length - 1) : null;
};
export const imageUrlFor = (base: string | null, key: string) => (base && IMAGE_KEY.test(key) ? `${base}/${key.split("/").map(encodeURIComponent).join("/")}` : null);
