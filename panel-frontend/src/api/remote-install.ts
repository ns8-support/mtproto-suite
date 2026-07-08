/**
 * API для удалённой установки service-node через SSH.
 */

export interface SshTestRequest {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface SshTestResult {
  success: boolean;
  system?: string;
  error?: string;
}

export interface RemoteInstallRequest {
  ssh: SshTestRequest;
  nodePort?: number;
  nginxPort?: number;
  natIp?: string;
}

export interface RemoteInstallResult {
  success: boolean;
  serverIp: string;
  port: number;
  authToken: string;
  log: string;
  error?: string;
}

import { request } from './index';

export async function testSsh(data: SshTestRequest): Promise<SshTestResult> {
  return request('POST', '/api/remote-install/test-ssh', data, { timeoutMs: 30000 });
}

export async function installRemoteNode(
  data: RemoteInstallRequest
): Promise<RemoteInstallResult> {
  return request('POST', '/api/remote-install/node', data, { timeoutMs: 600000 });
}
