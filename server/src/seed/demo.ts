import type { AppContext } from '../context';
import type { DB } from '../db';
import { applyStayEvent } from '../services/stays';
import { addHours, nowIso } from '../lib/clock';

/**
 * DEMO FIXTURES ONLY. Every row is flagged is_demo=1 and labelled as such in the
 * UI. Room labels are deliberately fictitious ("DEMO-101"); prices, hours and
 * events are samples, not the hotel's real information.
 */
const P = 'palace-anfa';

function content(db: DB) {
  const ins = db.prepare(
    `INSERT INTO content_items (property_id, kind, title_fr, title_en, body_fr, body_en, starts_at, ends_at, sort, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  ins.run(P, 'info', 'Bienvenue (contenu de démonstration)', 'Welcome (demo content)',
    "Ce texte est un exemple. Il sera remplacé par les informations validées par l'hôtel.",
    'This text is a sample. It will be replaced with hotel-approved information.', null, null, 1);
  ins.run(P, 'info', 'Wi-Fi (exemple)', 'Wi-Fi (sample)', 'Réseau et accès : à compléter par la réception.', 'Network and access: to be provided by reception.', null, null, 2);
  ins.run(P, 'hours', 'Room Service (horaires fictifs)', 'Room Service (sample hours)', 'Exemple : 07:00 – 23:00', 'Example: 07:00 – 23:00', null, null, 1);
  ins.run(P, 'hours', 'Piscine (horaires fictifs)', 'Pool (sample hours)', 'Exemple : 09:00 – 19:00', 'Example: 09:00 – 19:00', null, null, 2);
  ins.run(P, 'contact', 'Réception', 'Reception', 'Numéro interne : à configurer', 'Internal extension: to be configured', null, null, 1);
  ins.run(P, 'contact', 'Room Service', 'Room Service', 'Numéro interne : à configurer', 'Internal extension: to be configured', null, null, 2);
  const inAWeek = addHours(nowIso(), 24 * 5);
  ins.run(P, 'event', 'Soirée musicale (événement fictif)', 'Music evening (sample event)', 'Événement de démonstration.', 'Demonstration event.', inAWeek, addHours(inAWeek, 3), 1);
  // Other properties: placeholder information only; they cannot receive requests.
  for (const pid of ['hotel-suisse', 'palm-plaza', 'palm-appart-club']) {
    ins.run(pid, 'info', 'Bientôt disponible', 'Coming soon', "Les demandes via l'application ne sont pas encore ouvertes pour cet hôtel.",
      'In-app requests are not yet open for this hotel.', null, null, 1);
  }
}

function rooms(db: DB) {
  const ins = db.prepare('INSERT INTO rooms (property_id, label, is_demo) VALUES (?, ?, 1)');
  for (const floor of [1, 2]) for (let n = 1; n <= 6; n++) ins.run(P, `DEMO-${floor}0${n}`);
  const loc = db.prepare('INSERT INTO delivery_locations (property_id, zone, label_fr, label_en, sort, is_demo) VALUES (?, ?, ?, ?, ?, 1)');
  for (let n = 1; n <= 4; n++) loc.run(P, 'pool', `Piscine – Transat L${n} (démo)`, `Pool – Lounger L${n} (demo)`, n);
  for (let n = 1; n <= 2; n++) loc.run(P, 'pool', `Piscine – Table T${n} (démo)`, `Pool – Table T${n} (demo)`, 10 + n);
}

function menu(db: DB) {
  const cat = db.prepare('INSERT INTO food_categories (property_id, name_fr, name_en, sort) VALUES (?, ?, ?, ?)');
  const item = db.prepare(
    `INSERT INTO food_items (property_id, category_id, name_fr, name_en, description_fr, description_en, price_minor, available, sort, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  const group = db.prepare('INSERT INTO food_option_groups (food_item_id, name_fr, name_en, min_select, max_select, sort) VALUES (?, ?, ?, ?, ?, ?)');
  const opt = db.prepare('INSERT INTO food_options (group_id, name_fr, name_en, price_delta_minor, sort) VALUES (?, ?, ?, ?, ?)');
  const id = (r: { lastInsertRowid: number | bigint }) => Number(r.lastInsertRowid);

  const breakfast = id(cat.run(P, 'Petit-déjeuner', 'Breakfast', 1));
  const mains = id(cat.run(P, 'Plats', 'Mains', 2));
  const drinks = id(cat.run(P, 'Boissons', 'Drinks', 3));

  const omelette = id(item.run(P, breakfast, 'Omelette', 'Omelette', 'Plat de démonstration.', 'Demonstration dish.', 9000, 1, 1));
  const g1 = id(group.run(omelette, 'Garniture', 'Filling', 0, 2, 1));
  opt.run(g1, 'Fromage', 'Cheese', 0, 1);
  opt.run(g1, 'Champignons', 'Mushrooms', 1000, 2);
  item.run(P, breakfast, 'Corbeille de viennoiseries', 'Pastry basket', 'Plat de démonstration.', 'Demonstration dish.', 7000, 1, 2);

  const club = id(item.run(P, mains, 'Club sandwich', 'Club sandwich', 'Plat de démonstration.', 'Demonstration dish.', 14000, 1, 1));
  const g2 = id(group.run(club, 'Accompagnement', 'Side', 1, 1, 1));
  opt.run(g2, 'Frites', 'Fries', 0, 1);
  opt.run(g2, 'Salade', 'Salad', 0, 2);
  const tagine = id(item.run(P, mains, 'Tajine de légumes', 'Vegetable tagine', 'Plat de démonstration.', 'Demonstration dish.', 16000, 1, 2));
  void tagine;
  item.run(P, mains, 'Plat du jour', 'Dish of the day', 'Exemple d’article indisponible.', 'Example of an unavailable item.', 18000, 0, 3);

  item.run(P, drinks, 'Thé à la menthe', 'Mint tea', 'Boisson de démonstration.', 'Demonstration drink.', 4000, 1, 1);
  item.run(P, drinks, "Jus d'orange frais", 'Fresh orange juice', 'Boisson de démonstration.', 'Demonstration drink.', 5000, 1, 2);
  item.run(P, drinks, 'Eau minérale', 'Mineral water', 'Boisson de démonstration.', 'Demonstration drink.', 3000, 1, 3);
}

function services(db: DB) {
  const ins = db.prepare(
    `INSERT INTO service_items (property_id, name_fr, name_en, description_fr, description_en, complimentary, price_minor, max_quantity, allow_details, sort, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  ins.run(P, 'Brosse à dents', 'Toothbrush', 'Kit brosse à dents et dentifrice.', 'Toothbrush and toothpaste kit.', 1, 0, 4, 0, 1);
  ins.run(P, 'Serviettes', 'Towels', 'Serviettes de bain supplémentaires.', 'Extra bath towels.', 1, 0, 6, 1, 2);
  ins.run(P, 'Oreiller supplémentaire', 'Extra pillow', '', '', 1, 0, 2, 1, 3);
  ins.run(P, 'Kit de rasage', 'Shaving kit', '', '', 1, 0, 2, 0, 4);
  // A visible-fee example, to demonstrate that charges are always shown up front.
  ins.run(P, 'Repassage (exemple payant)', 'Pressing (paid example)', 'Tarif de démonstration.', 'Demonstration fee.', 0, 5000, 3, 1, 5);
}

export interface DemoSeedResult {
  stays: { guestName: string; room: string; activationUrl: string }[];
}

export function seedDemo(ctx: AppContext): DemoSeedResult {
  const { db } = ctx;
  if (db.prepare('SELECT COUNT(*) FROM rooms WHERE property_id = ?').pluck().get(P)) {
    throw new Error('Demo data already present. Use `npm run db:reset-demo` to start over.');
  }
  db.transaction(() => {
    content(db);
    rooms(db);
    menu(db);
    services(db);
  })();
  const roomId = (label: string) => db.prepare('SELECT id FROM rooms WHERE property_id = ? AND label = ?').pluck().get(P, label) as number;
  const departure = (days: number) => {
    const d = new Date(nowIso());
    d.setUTCDate(d.getUTCDate() + days);
    d.setUTCHours(11, 0, 0, 0);
    return d.toISOString();
  };
  const stays = [
    { guestName: 'Famille Démo A', room: 'DEMO-101', occupants: 2, days: 3 },
    { guestName: 'Demo Guest B', room: 'DEMO-102', occupants: 1, days: 1 },
  ].map((s) => {
    const out = applyStayEvent(
      ctx,
      P,
      { kind: 'check_in', guestName: s.guestName, roomId: roomId(s.room), occupants: s.occupants, scheduledDeparture: departure(s.days) },
      { source: 'demo', isDemo: true },
    );
    return { guestName: s.guestName, room: s.room, activationUrl: out.qr!.url };
  });
  return { stays };
}
