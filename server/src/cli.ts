/**
 * Operational commands:
 *   migrate | setup | seed-demo | reset-demo | backup [dir] | generate-vapid
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config';
import { migrate, openDatabase } from './db';
import { buildApp } from './app';
import { seedBase, demoPasswords } from './seed/base';
import { seedDemo } from './seed/demo';

const [, , command, arg] = process.argv;
const config = { ...loadConfig(), silentLogs: true, clientDist: null };

async function seed() {
  const { ctx, close } = await buildApp(config, { startWorker: false });
  const passwords = demoPasswords();
  seedBase(ctx.db, passwords);
  const out = seedDemo(ctx);
  close();
  ctx.db.close();
  console.log('\nDemo data created (all rows flagged as demo).');
  console.log('\nStaff accounts (change these passwords before any real use):');
  console.log(`  Room Service  palace.roomservice / ${passwords.roomService}`);
  console.log(`  Reception     palace.reception   / ${passwords.reception}`);
  console.log(`  Admin         palace.admin       / ${passwords.admin}`);
  console.log('\nPrivate activation for the demo stays (shown once; reissue from Reception > Stays & QR):');
  for (const s of out.stays) console.log(`  ${s.guestName} — room ${s.room}\n    QR link: ${s.activationUrl}\n    Code:    ${s.code}`);
  console.log('');
}

async function main() {
  switch (command) {
    case 'migrate': {
      const db = openDatabase(config.dbPath);
      const ran = migrate(db);
      db.close();
      console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
      break;
    }
    case 'setup': {
      // Base configuration only (properties, department accounts, named tablets). No demo data.
      const env = process.env;
      const missing = ['SEED_ROOM_SERVICE_PASSWORD', 'SEED_RECEPTION_PASSWORD', 'SEED_ADMIN_PASSWORD'].filter((k) => (env[k] ?? '').length < 10);
      if (missing.length) throw new Error(`Set ${missing.join(', ')} (min. 10 characters each) before running setup.`);
      const db = openDatabase(config.dbPath);
      migrate(db);
      seedBase(db, demoPasswords());
      db.close();
      console.log('Base configuration created: 4 properties (requests enabled for palace-anfa only), Room Service / Reception / Admin accounts, 4 named tablets.');
      console.log('Next: add rooms, pool locations, menus, services and hotel information in Admin.');
      break;
    }
    case 'seed-demo':
      await seed();
      break;
    case 'reset-demo': {
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_RESET !== 'true') {
        throw new Error('Refusing to reset in production (set ALLOW_RESET=true to override).');
      }
      for (const suffix of ['', '-wal', '-shm']) rmSync(config.dbPath + suffix, { force: true });
      await seed();
      break;
    }
    case 'backup': {
      // better-sqlite3's online backup API produces a consistent copy while the server runs.
      const dir = path.resolve(arg || 'backups');
      mkdirSync(dir, { recursive: true });
      if (!existsSync(config.dbPath)) throw new Error(`No database at ${config.dbPath}`);
      const db = openDatabase(config.dbPath);
      const file = path.join(dir, `palace-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
      await db.backup(file);
      db.close();
      console.log(`Backup written: ${file}`);
      break;
    }
    case 'generate-vapid': {
      const webpush = (await import('web-push')).default;
      const keys = webpush.generateVAPIDKeys();
      console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:it@your-hotel.example`);
      break;
    }
    default:
      console.log('Usage: cli.ts migrate | setup | seed-demo | reset-demo | backup [dir] | generate-vapid');
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
