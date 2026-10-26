import request from 'mslx-request';

export const LOLIA_OAUTH_CLIENT_ID = 'ajp1yp2ztx3m9pku';
export const LOLIA_AUTH_ENDPOINT = 'https://dash.lolia.link/oauth/authorize';
export const LOLIA_TOKEN_ENDPOINT = '/api/plugin/mslx-plugin-lolia-frp/oauth2/token';
export const OFFICIAL_REDIRECT_URI = 'https://mslx.mslmc.cn/third-party/lolia-frp/callback';
export const STORAGE_KEY = 'lolia_frp_user';
export const PKCE_SESSION_KEY = 'lolia_frp_pkce_session';

export interface StoredLoliaUser {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  tokenType?: string;
  username?: string;
  avatar?: string;
  email?: string;
  role?: string;
  bandwidthLimit?: number;
  maxTunnelCount?: number;
  trafficLimit?: number;
  trafficUsed?: number;
  hasKyc?: boolean;
  kycStatus?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface PkceSession {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
  redirectUri: string;
  createdAt: number;
}

/**
 * 生成随机字符串
 */
export function generateRandomString(length = 64): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = new Uint8Array(length);
  window.crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

/**
 * Base64 URL-safe 编码
 */
function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * 生成 SHA-256 PKCE Code Challenge
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await window.crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(hash);
}

/**
 * 创建 PKCE 授权会话（默认使用官方登记的重定向地址 https://mslx.mslmc.cn）
 */
export async function createPkceAuthSession(redirectUri = OFFICIAL_REDIRECT_URI): Promise<{ session: PkceSession; authUrl: string }> {
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateRandomString(16);

  const session: PkceSession = {
    codeVerifier,
    codeChallenge,
    state,
    redirectUri,
    createdAt: Date.now(),
  };

  sessionStorage.setItem(PKCE_SESSION_KEY, JSON.stringify(session));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LOLIA_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'all',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `${LOLIA_AUTH_ENDPOINT}?${params.toString()}`;

  return { session, authUrl };
}

/**
 * 获取当前的 PKCE 会话缓存
 */
export function getSavedPkceSession(): PkceSession | null {
  const saved = sessionStorage.getItem(PKCE_SESSION_KEY);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as PkceSession;
  } catch {
    return null;
  }
}

/**
 * 使用授权码 Code 换取 Access Token
 */
export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri = OFFICIAL_REDIRECT_URI
): Promise<TokenResponse> {
  const payload = {
    grant_type: 'authorization_code',
    client_id: LOLIA_OAUTH_CLIENT_ID,
    code: code.trim(),
    code_verifier: codeVerifier.trim(),
    redirect_uri: redirectUri,
  };

  try {
    const data: any = await request.post(
      {
        url: LOLIA_TOKEN_ENDPOINT,
        data: payload,
      },
      {
        isTransformResponse: false,
      }
    );

    if (!data || data.error) {
      throw new Error(data?.error_description || data?.error || data?.msg || '获取 Access Token 失败');
    }

    return data as TokenResponse;
  } catch (err: any) {
    const errData = err.response?.data;
    if (errData && (errData.error_description || errData.error || errData.msg || errData.message)) {
      throw new Error(errData.error_description || errData.error || errData.msg || errData.message);
    }
    throw err;
  }
}

/**
 * 刷新 Access Token
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const payload = {
    grant_type: 'refresh_token',
    client_id: LOLIA_OAUTH_CLIENT_ID,
    refresh_token: refreshToken.trim(),
  };

  try {
    const data: any = await request.post(
      {
        url: LOLIA_TOKEN_ENDPOINT,
        data: payload,
      },
      {
        isTransformResponse: false,
      }
    );

    if (!data || data.error) {
      throw new Error(data?.error_description || data?.error || data?.msg || '刷新令牌失败');
    }

    return data as TokenResponse;
  } catch (err: any) {
    const errData = err.response?.data;
    if (errData && (errData.error_description || errData.error || errData.msg || errData.message)) {
      throw new Error(errData.error_description || errData.error || errData.msg || errData.message);
    }
    throw err;
  }
}

/**
 * 本地存储读写
 */
export function getStoredLoliaUser(): StoredLoliaUser | null {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as StoredLoliaUser;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function saveStoredLoliaUser(user: StoredLoliaUser) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function clearStoredLoliaUser() {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(PKCE_SESSION_KEY);
}

/**
 * 校验并获取有效的 Access Token（若过期则自动刷新）
 */
export async function getValidAccessToken(): Promise<string> {
  const user = getStoredLoliaUser();
  if (!user || !user.accessToken) {
    throw new Error('未登录或登录已过期，请重新授权');
  }

  const isExpired = user.accessTokenExpiresAt && Date.now() >= user.accessTokenExpiresAt - 60_000;
  if (isExpired && user.refreshToken) {
    try {
      const refreshed = await refreshAccessToken(user.refreshToken);
      const updatedUser: StoredLoliaUser = {
        ...user,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token || user.refreshToken,
        accessTokenExpiresAt: refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : undefined,
        tokenType: refreshed.token_type || user.tokenType || 'Bearer',
      };
      saveStoredLoliaUser(updatedUser);
      return updatedUser.accessToken;
    } catch {
      clearStoredLoliaUser();
      throw new Error('登录凭据已失效，请重新授权');
    }
  }

  return user.accessToken;
}

/**
 * 获取有效 Authorization 请求头
 */
export async function getLoliaAuthorizationHeader(): Promise<string> {
  const token = await getValidAccessToken();
  return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
}
