import type { DB } from '../db';
import { hashPassword } from '../lib/crypto';
import { nowIso } from '../lib/clock';

/**
 * Base configuration: properties, department accounts and named devices.
 * This is setup data, kept separate from live guest data and from demo fixtures.
 * Coordinates are approximate CITY centres, used only to suggest a city's hotels.
 */
export const PROPERTIES = [
  { id: 'palace-anfa', name: "Le Palace d'Anfa", city: 'casablanca', prefix: 'PA', rooms: 156, enabled: 1, sort: 1, lat: 33.5731, lng: -7.5898,
    tagFr: 'Casablanca', tagEn: 'Casablanca', tagEs: 'Casablanca' },
  { id: 'hotel-suisse', name: 'Hôtel Suisse', city: 'casablanca', prefix: 'HS', rooms: null, enabled: 0, sort: 2, lat: 33.5731, lng: -7.5898,
    tagFr: 'Casablanca · bientôt disponible', tagEn: 'Casablanca · coming soon', tagEs: 'Casablanca · próximamente' },
  { id: 'palm-plaza', name: 'Palm Plaza', city: 'marrakech', prefix: 'PP', rooms: null, enabled: 0, sort: 3, lat: 31.6295, lng: -7.9811,
    tagFr: 'Marrakech · bientôt disponible', tagEn: 'Marrakesh · coming soon', tagEs: 'Marrakech · próximamente' },
  { id: 'palm-appart-club', name: 'Palm Appart Club', city: 'marrakech', prefix: 'PAC', rooms: null, enabled: 0, sort: 4, lat: 31.6295, lng: -7.9811,
    tagFr: 'Marrakech · bientôt disponible', tagEn: 'Marrakesh · coming soon', tagEs: 'Marrakech · próximamente' },
] as const;

export interface BasePasswords {
  roomService: string;
  reception: string;
  admin: string;
}

export function demoPasswords(env: NodeJS.ProcessEnv = process.env): BasePasswords {
  return {
    roomService: env.SEED_ROOM_SERVICE_PASSWORD || 'demo-roomservice',
    reception: env.SEED_RECEPTION_PASSWORD || 'demo-reception',
    admin: env.SEED_ADMIN_PASSWORD || 'demo-admin-pass',
  };
}

export function seedBase(db: DB, passwords: BasePasswords) {
  const now = nowIso();
  db.transaction(() => {
    const insP = db.prepare(
      `INSERT OR IGNORE INTO properties (id, name, city, tagline_fr, tagline_en, approx_lat, approx_lng, room_count, ref_prefix, requests_enabled, activation_check, sort, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'room', ?, ?)`,
    );
    for (const p of PROPERTIES) insP.run(p.id, p.name, p.city, p.tagFr, p.tagEn, p.lat, p.lng, p.rooms, p.prefix, p.enabled, p.sort, now);
    const tagEs = db.prepare('UPDATE properties SET tagline_es = ? WHERE id = ?');
    for (const p of PROPERTIES) tagEs.run(p.tagEs, p.id);

    const insA = db.prepare(
      `INSERT OR IGNORE INTO department_accounts (id, property_id, role, username, display_name_fr, display_name_en, display_name_es, password_hash, created_at)
       VALUES (?, 'palace-anfa', ?, ?, ?, ?, ?, ?, ?)`,
    );
    insA.run('palace-anfa:room_service', 'room_service', 'palace.roomservice', 'Room Service', 'Room Service', 'Room Service', hashPassword(passwords.roomService), now);
    insA.run('palace-anfa:reception', 'reception', 'palace.reception', 'Réception', 'Reception', 'Recepción', hashPassword(passwords.reception), now);
    insA.run('palace-anfa:admin', 'admin', 'palace.admin', 'Administration', 'Administration', 'Administración', hashPassword(passwords.admin), now);

    const insD = db.prepare('INSERT OR IGNORE INTO devices (account_id, name, created_at) VALUES (?, ?, ?)');
    insD.run('palace-anfa:room_service', 'Room Service Tablet 1', now);
    insD.run('palace-anfa:room_service', 'Room Service Tablet 2', now);
    insD.run('palace-anfa:reception', 'Reception Tablet 1', now);
    insD.run('palace-anfa:reception', 'Reception Tablet 2', now);
  })();
}
