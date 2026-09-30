import type { AppContext } from '../context';
import { nowIso } from '../lib/clock';

const MAX_ATTEMPTS = 5;

const PUSH_TEXT = {
  fr: { title: "Le Palace d'Anfa", body: (ref: string) => `Nous avons essayé de vous joindre pour confirmer la demande ${ref}, sans réponse.` },
  en: { title: "Le Palace d'Anfa", body: (ref: string) => `We tried to reach you to confirm request ${ref} but got no answer.` },
  es: { title: "Le Palace d'Anfa", body: (ref: string) => `Intentamos contactarle para confirmar la solicitud ${ref}, sin respuesta.` },
};

/**
 * Delivers persisted guest notices outside the app via Web Push when configured
 * and permitted. The in-app notice is the source of truth; push is best-effort.
 * Pending jobs survive restarts and are processed at startup.
 */
export class NotificationWorker {
  private running = false;
  private again = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private ctx: AppContext) {}

  start(intervalMs = 30_000) {
    this.kick();
    this.timer = setInterval(() => this.kick(), intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  kick() {
    if (this.running) {
      this.again = true;
      return;
    }
    void this.processPending();
  }

  async processPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      do {
        this.again = false;
        const { db, push } = this.ctx;
        const jobs = db.prepare(`SELECT * FROM notification_jobs WHERE status = 'pending' ORDER BY id LIMIT 50`).all() as Record<string, any>[];
        for (const job of jobs) {
          const notice = db
            .prepare(`SELECT n.*, r.ref FROM guest_notices n LEFT JOIN requests r ON r.id = n.request_id WHERE n.id = ?`)
            .get(job.notice_id) as Record<string, any>;
          const finish = (status: string, error: string | null) =>
            db.prepare('UPDATE notification_jobs SET status = ?, last_error = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?').run(status, error, nowIso(), job.id);
          if (!push.configured) {
            finish('skipped', 'push_unconfigured');
            continue;
          }
          const subs = db
            .prepare(
              `SELECT p.*, s.language FROM push_subscriptions p JOIN guest_sessions s ON s.id = p.guest_session_id
               WHERE s.stay_id = ? AND s.revoked_at IS NULL AND s.capability = 'order'`,
            )
            .all(notice.stay_id) as Record<string, any>[];
          if (subs.length === 0) {
            finish('skipped', 'no_subscription');
            continue;
          }
          let delivered = 0;
          let lastError: string | null = null;
          for (const sub of subs) {
            const lang: keyof typeof PUSH_TEXT = sub.language === 'en' || sub.language === 'es' ? sub.language : 'fr';
            const payload = JSON.stringify({
              title: PUSH_TEXT[lang].title,
              body: PUSH_TEXT[lang].body(notice.ref ?? ''),
              url: notice.ref ? `/h/requests/${notice.ref}` : '/h/requests',
              tag: `notice-${notice.id}`,
            });
            const result = await push.send({ endpoint: sub.endpoint, keys: JSON.parse(sub.keys_json) }, payload);
            if (result.ok) delivered++;
            else {
              lastError = result.error;
              if (result.gone) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
            }
          }
          if (delivered > 0) finish('sent', null);
          else if (job.attempts + 1 >= MAX_ATTEMPTS) finish('failed', lastError);
          else db.prepare('UPDATE notification_jobs SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?').run(lastError, nowIso(), job.id);
        }
      } while (this.again);
    } catch (err) {
      this.ctx.log.error('notification_worker_failed', { error: (err as Error).message });
    } finally {
      this.running = false;
    }
  }
}
