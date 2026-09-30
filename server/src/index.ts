import { loadConfig } from './config';
import { buildApp } from './app';

const config = loadConfig();
const { app, ctx, close } = await buildApp(config);

const server = app.listen(config.port, () => {
  const pms = ctx.pms.status('palace-anfa');
  ctx.log.info('server_started', {
    port: config.port,
    pms: pms.adapter,
    pmsLive: pms.liveChecks,
    push: ctx.push.configured,
    bills: ctx.bills.configured,
    ordering: config.orderingProperties.join(','),
  });
});

function shutdown() {
  close();
  server.close(() => {
    ctx.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
