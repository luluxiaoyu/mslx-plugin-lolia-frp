import { getLoliaAuthorizationHeader } from './auth';

export const LOLIA_API_BASE_URL = 'https://api.lolia.link/api/v1';

export interface LoliaApiResponse<T = any> {
  code: number;
  msg: string;
  data: T;
}

export interface LoliaUserInfo {
  id: number;
  username: string;
  avatar: string;
  email: string;
  role: string;
  bandwidth_limit: number;
  max_tunnel_count: number;
  traffic_limit: number;
  traffic_used: number;
  has_kyc: boolean;
  kyc_status: string;
  today_checked: boolean;
}

export interface LoliaTunnel {
  id: number;
  name: string;
  node_id: number;
  node_name: string;
  node_address: string;
  local_ip: string;
  local_port: number;
  remote_port: number;
  type: string;
  custom_domain: string;
  remark: string;
  status: string;
  bandwidth_limit: number;
  auto_tls?: boolean;
}

export interface LoliaNode {
  id: number;
  name: string;
  region_code: string;
  status: string;
  supported_protocols: string[];
  need_kyc: boolean;
  beian_required: boolean;
  frps_version?: string;
  agent_version?: string;
  sponsor?: string;
  bandwidth: number;
  remark: string;
  load: number;
}

export interface CreateTunnelParams {
  node_id: number;
  type: string;
  local_ip: string;
  local_port: number;
  remote_port: number;
  custom_domain: string;
  remark: string;
}

async function requestLoliaApi<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const authHeader = await getLoliaAuthorizationHeader();
  const url = `${LOLIA_API_BASE_URL}${path.startsWith('/') ? path : '/' + path}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: authHeader,
    ...(options.headers as Record<string, string> || {}),
  };

  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const resJson: LoliaApiResponse<T> = await response.json();

  if (!response.ok || (resJson.code !== 200 && resJson.code !== 0 && resJson.code !== 201)) {
    throw new Error(resJson.msg || (resJson as any).message || `请求失败 (${response.status})`);
  }

  return resJson.data;
}

/**
 * 获取用户信息
 */
export async function fetchUserInfo(): Promise<LoliaUserInfo> {
  return requestLoliaApi<LoliaUserInfo>('/user/info');
}

/**
 * 获取用户隧道列表
 */
export async function fetchTunnels(): Promise<LoliaTunnel[]> {
  const data = await requestLoliaApi<{ list: LoliaTunnel[]; total: number }>('/user/tunnel');
  return data?.list || [];
}

/**
 * 获取节点列表
 */
export async function fetchNodes(): Promise<LoliaNode[]> {
  const data = await requestLoliaApi<{ nodes: LoliaNode[]; total: number }>('/user/nodes', {
    method: 'POST',
    body: JSON.stringify({ page: 1, limit: 1000 }),
  });
  return data?.nodes || [];
}

/**
 * 创建隧道
 */
export async function createTunnel(params: CreateTunnelParams): Promise<any> {
  return requestLoliaApi('/user/tunnel', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/**
 * 删除隧道
 */
export async function deleteTunnel(tunnelName: string): Promise<any> {
  return requestLoliaApi(`/user/tunnel/${encodeURIComponent(tunnelName)}`, {
    method: 'DELETE',
  });
}

/**
 * 获取隧道 frpc 配置内容
 */
export async function fetchTunnelConfig(tunnelName: string): Promise<{ config: string; lolia_config?: string }> {
  return requestLoliaApi<{ config: string; lolia_config?: string }>(
    `/user/frpc/config?tunnel=${encodeURIComponent(tunnelName)}`
  );
}
