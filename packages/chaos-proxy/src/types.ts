import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

/** Anything with an MCP `connect(transport)`: the SDK's low-level `Server` or `McpServer`. */
export type InprocServer = { connect(transport: Transport): Promise<void>; close?(): Promise<void> };

type Common = {
  name: string;
  /** Mobile upstreams get mobile faults; everything else gets API faults. Defaults to `name === 'mobile'`. */
  mobile?: boolean;
};

export type UpstreamSpec =
  | (Common & { transport: 'stdio'; command: string; args?: string[]; env?: Record<string, string> })
  | (Common & { transport: 'http'; url: string; headers?: Record<string, string> })
  /** A factory is preferred: a server instance can only be connected once, so reconnects need a fresh one. */
  | (Common & { transport: 'inproc'; server: InprocServer | (() => InprocServer | Promise<InprocServer>) });
