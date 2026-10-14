import type { SeriesCard } from "../api/viewer";

/** What the UI renders for one series. Built from the backend's SeriesCard; ids are strings (BIGINT on the server). */
export type Show = { id: string; slug: string; title: string; genre: string; tags: string[]; episodes: number; image: string; desc: string; badge?: "HOT" | "DUBBED"; maturity: string; year: number | null; language: string };

const LANGUAGES: Record<string, string> = { hi: "Hindi", en: "English", ta: "Tamil", te: "Telugu", bn: "Bengali", mr: "Marathi" };
export const languageName = (code: string) => LANGUAGES[code] ?? code.toUpperCase();

/** Public image hosts that support on-the-fly sizing get a width hint so cards don't download full-size photos. */
export function sizedImage(url: string, width: number): string {
  try { const u = new URL(url); if (u.hostname === "images.unsplash.com" && !u.search) return `${url}?auto=format&fit=crop&w=${width}&q=80`; } catch { /* relative or invalid: use as is */ }
  return url;
}

/** Deterministic gradient poster used when a series has no image yet (never a broken image). */
export function placeholderPoster(title: string): string {
  let h = 0; for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360, b = (a + 55) % 360;
  const initials = title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a} 65% 32%)"/><stop offset="1" stop-color="hsl(${b} 70% 14%)"/></linearGradient></defs><rect width="400" height="600" fill="url(#g)"/><text x="200" y="330" font-family="Georgia,serif" font-size="120" fill="rgba(255,255,255,.55)" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function toShow(c: SeriesCard): Show {
  const dubbed = c.categories.some((x) => /dub/i.test(x.name));
  return {
    id: c.id, slug: c.slug, title: c.title, genre: c.genres[0]?.name ?? "Drama", tags: c.categories.map((x) => x.name), episodes: c.episodeCount,
    image: c.posterUrl ? sizedImage(c.posterUrl, 700) : placeholderPoster(c.title), desc: c.synopsis,
    badge: c.featured ? "HOT" : dubbed ? "DUBBED" : undefined, maturity: c.maturityRating, year: c.releaseYear, language: c.language,
  };
}

export const heroImage = (s: Show, bannerUrl?: string | null) => (bannerUrl ? sizedImage(bannerUrl, 1800) : s.image);
export const splitWords = (title: string) => { const w = title.split(" "); const k = Math.ceil(w.length / 2); return [w.slice(0, k).join(" "), w.slice(k).join(" ")] as const; };
export const fmtDuration = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const errorText = (e: unknown, fallback = "Something went wrong. Please try again.") => (e instanceof Error && e.message ? e.message : fallback);

/** Minimum sign-up age. The server enforces the same rule; this only gives instant feedback. */
export const MIN_AGE_YEARS = 14;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** The latest date of birth that is old enough today (for the date input's max). */
export const latestAllowedBirthDate = () => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - MIN_AGE_YEARS); return isoDay(d); };
/** "" when the date of birth is acceptable, otherwise the message to show. */
export function dateOfBirthProblem(v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Enter your date of birth.";
  const t = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || isoDay(t) !== v || v > isoDay(new Date()) || v < "1900-01-01") return "Enter a valid date of birth.";
  if (v > latestAllowedBirthDate()) return `You must be at least ${MIN_AGE_YEARS} years old to create an account.`;
  return "";
}
