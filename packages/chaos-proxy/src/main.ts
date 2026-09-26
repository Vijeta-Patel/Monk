import { loadConfig, openDb } from '@monk/shared';
import { startChaosProxy } from './proxy.ts';

const cfg = loadConfig();
const db = openDb(cfg.MONK_DB_PATH);
const proxy = await startChaosProxy({ cfg, db });
const st = proxy.control.state();
console.log(`chaos proxy on ${proxy.url} (control: ${proxy.url.replace(/\/mcp$/, '/chaos')}) profile=${st.profile} enabled=${st.enabled} seed=${st.seed}`);

const stop = async () => {
  await proxy.close();
  db.raw.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
