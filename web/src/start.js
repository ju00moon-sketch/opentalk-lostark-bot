import { loadConfig } from './config.js';
import { createWebServer } from './server.js';

let service;
try {
  process.umask(0o077);
  const config = loadConfig();
  if (config.port === 0) throw new Error('A fixed production port is required');
  service = createWebServer({ config });
  service.server.on('error', () => {
    console.error('Authentication listener failed');
    void service.close().then(() => { process.exitCode = 1; }, () => { process.exitCode = 1; });
  });
  service.server.listen(config.port, config.host, () => { console.log('Authentication service is ready'); });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 20000);
    timeout.unref();
    void service.close().then(() => { clearTimeout(timeout); }, () => { process.exitCode = 1; });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} catch {
  console.error('Authentication service configuration or storage is unavailable');
  if (service) void service.close().catch(() => {});
  process.exitCode = 1;
}
