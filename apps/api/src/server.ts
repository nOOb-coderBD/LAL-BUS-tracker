import { createRuntime } from './app.js';
import { cfg } from './config.js';
const runtime = await createRuntime();
runtime.httpServer.listen(cfg.PORT, '0.0.0.0', () =>
  console.log(`Lal Bus API listening on port ${cfg.PORT}`),
);
let closing = false;
const stop = () => {
  if (closing) return;
  closing = true;
  void runtime
    .close()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
