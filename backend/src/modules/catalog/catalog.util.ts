import { Repository } from 'typeorm';

export const slugify = (text: string): string =>
  text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'item';

/** `title` -> unique slug (`title`, `title-2`, ...). */
export async function uniqueSlug(repo: Repository<{ slug: string }>, base: string, ignoreId?: string): Promise<string> {
  const root = slugify(base);
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const found = await (repo as Repository<{ slug: string; id?: string }>).findOne({ where: { slug: candidate } });
    if (!found || (ignoreId && found.id === ignoreId)) return candidate;
  }
  return `${root}-${Date.now()}`;
}

/** Public images live under images/. Keys that could point at private video storage are rejected at validation time. */
export const IMAGE_KEY = /^images\/(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9/_.-]{0,200}$/;

/** SQL fragment: content that viewers may see right now. */
export const AVAILABLE = (alias: string) => `${alias}.status = 'PUBLISHED' AND ${alias}.published_at IS NOT NULL AND ${alias}.published_at <= :now`;

export const escapeLike = (v: string) => v.replace(/[\\%_]/g, '\\$&');
