import request from 'mslx-request';
import { getLoliaAuthorizationHeader } from './auth';

export const LOLIA_API_BASE_URL = '/api/plugin/mslx-plugin-lolia-frp';

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
  options: {
    method?: string;
    body?: any;
    data?: any;
    headers?: Record<string, string>;
  } = {}
): Promise<T> {
  const authHeader = await getLoliaAuthorizationHeader();
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  const url = `${LOLIA_API_BASE_URL}${cleanPath}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Lolia-Authorization': authHeader,
    ...(options.headers || {}),
  };

  let requestData = options.data;
  if (!requestData && options.body) {
    if (typeof options.body === 'string') {
      try {
        requestData = JSON.parse(options.body);
      } catch {
        requestData = options.body;
      }
    } else {
      requestData = options.body;
    }
  }

  try {
    const res: any = await request.request(
      {
        url,
        method: options.method || 'GET',
        data: requestData,
        headers,
      },
      {
        isTransformResponse: false,
      }
    );

    const resObj: any = res;

    // 校验 Lolia API 返回的 code 状态码
    if (resObj && typeof resObj.code === 'number') {
      if (resObj.code !== 200 && resObj.code !== 0 && resObj.code !== 201) {
        throw new Error(resObj.msg || resObj.message || `请求失败 (${resObj.code})`);
      }
      return resObj.data as T;
    }

    return resObj as T;
  } catch (err: any) {
    const errData = err.response?.data;
    if (errData && (errData.msg || errData.message || errData.error_description)) {
      throw new Error(errData.msg || errData.message || errData.error_description);
    }
    throw err;
  }
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
    data: { page: 1, limit: 1000 },
  });
  return data?.nodes || [];
}

/**
 * 创建隧道
 */
export async function createTunnel(params: CreateTunnelParams): Promise<any> {
  return requestLoliaApi('/user/tunnel', {
    method: 'POST',
    data: params,
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
