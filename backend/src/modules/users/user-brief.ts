import { EntityManager, In } from 'typeorm';
import { Profile, User } from '../../database/entities/index';

/** The compact "who is this" block admin lists show instead of a bare user id. */
export interface UserBrief { id: string; displayName: string | null; email: string | null; phone: string | null }

/** One query for users + one for profiles, however many ids (no N+1). Tombstones render as "Deleted user" with null contact. Unknown ids are simply absent. */
export async function loadUserBriefs(em: EntityManager, ids: string[]): Promise<Map<string, UserBrief>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, UserBrief>();
  if (!unique.length) return out;
  const [users, profiles] = await Promise.all([em.getRepository(User).find({ where: { id: In(unique) }, select: ['id', 'email', 'phone'] }), em.getRepository(Profile).find({ where: { userId: In(unique) }, select: ['userId', 'displayName'] })]);
  const names = new Map(profiles.map((p) => [p.userId, p.displayName]));
  for (const u of users) out.set(u.id, { id: u.id, displayName: names.get(u.id) ?? null, email: u.email, phone: u.phone });
  return out;
}
