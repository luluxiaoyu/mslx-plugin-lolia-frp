/**
 * 将 INI 格式的 FRP 配置文件转换为 TOML 格式
 */
export function convertIniToToml(config: string): string {
  let content = (config || '').trim();
  if (!content) return '';

  // 如果是 Base64 编码的配置，自动进行解码
  try {
    if (!content.includes('\n') && /^[A-Za-z0-9+/=]+$/.test(content)) {
      const binaryStr = atob(content);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      content = new TextDecoder('utf-8').decode(bytes).trim();
    }
  } catch {
    // 忽略解码异常，按原始内容继续处理
  }

  // 如果已经包含 [[proxies]] 或 serverAddr 等 TOML 特征，直接返回
  if (content.includes('[[proxies]]') || content.includes('serverAddr =') || content.includes('serverAddr=')) {
    return content;
  }

  const keyMapping: Record<string, string> = {
    tls_enable: 'transport.tls.enable',
    token: 'auth.token',
    protocol: 'transport.protocol',
    pool_count: 'transport.poolCount',
    tcp_mux: 'transport.tcpMux',
    login_fail_exit: 'loginFailExit',
    custom_domains: 'customDomains',
    locations: 'locations',
    host_header_rewrite: 'hostHeaderRewrite',
    role: 'role',
    sk: 'sk',
  };

  const lines = content.split(/\r?\n/);
  let currentSection = '';
  const rootParams: Record<string, any> = {};
  const proxies: Record<string, any>[] = [];
  let currentProxy: Record<string, any> | null = null;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) return;

    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (currentSection === 'common') {
        currentProxy = null;
      } else {
        currentProxy = { name: currentSection };
        proxies.push(currentProxy);
      }
      return;
    }

    const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
    if (kvMatch) {
      const rawKey = kvMatch[1].trim();
      let value: string | number | boolean = kvMatch[2].trim();

      let key = rawKey;
      if (keyMapping[rawKey]) {
        key = keyMapping[rawKey];
      } else {
        key = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        key = key.replace(/Ip/g, 'IP');
      }

      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (!isNaN(Number(value)) && value !== '') value = Number(value);
      else value = String(value);

      if (currentSection === 'common' || !currentSection) {
        rootParams[key] = value;
      } else if (currentProxy) {
        currentProxy[key] = value;
      }
    }
  });

  let tomlOutput = '';
  Object.entries(rootParams).forEach(([k, v]) => {
    const valStr = typeof v === 'string' ? `"${v}"` : v;
    tomlOutput += `${k} = ${valStr}\n`;
  });

  proxies.forEach((proxy) => {
    tomlOutput += `\n[[proxies]]\n`;
    Object.entries(proxy).forEach(([k, v]) => {
      const valStr = typeof v === 'string' ? `"${v}"` : v;
      tomlOutput += `${k} = ${valStr}\n`;
    });
  });

  return tomlOutput.trim();
}

/**
 * 格式化字节大小
 */
export function formatBytes(bytes: number | null | undefined, decimals = 2): string {
  if (bytes == null || isNaN(bytes) || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
