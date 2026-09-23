<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, h } from 'vue';
import {
  UserCircleIcon,
  ServerIcon,
  CloudIcon,
  AddIcon,
  PlayCircleIcon,
  RefreshIcon,
  DeleteIcon,
  LinkIcon,
} from 'tdesign-icons-vue-next';
import { MessagePlugin, DialogPlugin, Input } from 'tdesign-vue-next';
import request from 'mslx-request';
import {
  getStoredLoliaUser,
  saveStoredLoliaUser,
  clearStoredLoliaUser,
  createPkceAuthSession,
  getSavedPkceSession,
  exchangeCodeForToken,
  OFFICIAL_REDIRECT_URI,
  type StoredLoliaUser,
} from '../api/auth';
import {
  fetchUserInfo,
  fetchTunnels,
  fetchTunnelConfig,
  deleteTunnel,
  type LoliaUserInfo,
  type LoliaTunnel,
} from '../api/lolia';
import { convertIniToToml, formatBytes } from '../api/utils';
import CreateTunnelDialog from './components/CreateTunnelDialog.vue';

const globalRouter = (window as any).VueRouter?.useRouter?.() || (window as any).MSLX_Router;
const showCreateDialog = ref(false);
const loliaUser = ref<StoredLoliaUser | null>(null);

const loading = ref(false);
const userInfo = ref<LoliaUserInfo | null>(null);
const tunnels = ref<LoliaTunnel[]>([]);
const selectedTunnelId = ref<number | null>(null);

const isAuthorizing = ref(false);
const showManualAuthDialog = ref(false);
const manualAuthInput = ref('');
const isSubmittingCode = ref(false);

const isAddingTunnel = ref(false);
const isDeleting = ref(false);

const popupWindow = ref<Window | null>(null);
let pollTimer: number | null = null;

const hasAuth = computed(() => Boolean(loliaUser.value?.accessToken));

const currentTunnel = computed(() => {
  return tunnels.value.find((t) => t.id === selectedTunnelId.value) || null;
});

const isTunnelOnline = (t: LoliaTunnel) => {
  const st = (t.status || '').toLowerCase();
  return st === 'active' || st === 'online' || st === 'true';
};

// 监听输入框变化，粘贴后自动识别并登录
watch(manualAuthInput, (val) => {
  const trimmed = val.trim();
  if (trimmed && (trimmed.includes('code=') || trimmed.length >= 20)) {
    void handleManualAuthSubmit();
  }
});

onMounted(() => {
  window.addEventListener('message', handleOAuthMessage);
  window.addEventListener('focus', handleWindowFocus);
  handleUrlCallback();

  const stored = getStoredLoliaUser();
  if (stored && stored.accessToken) {
    loliaUser.value = stored;
    void initDashboardData(false);
  }
});

onBeforeUnmount(() => {
  stopPolling();
  window.removeEventListener('message', handleOAuthMessage);
  window.removeEventListener('focus', handleWindowFocus);
  if (popupWindow.value && !popupWindow.value.closed) {
    popupWindow.value.close();
  }
});

function stopPolling() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function openUrl(url: string) {
  window.open(url, '_blank');
}

/**
 * 弹出居中授权窗口（适配手机与桌面端）
 */
function openLoginPopup(url: string, title = 'Lolia FRP 授权登录', w = 600, h = 700) {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile) {
    return window.open(url, '_blank');
  }

  const dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : window.screenX;
  const dualScreenTop = window.screenTop !== undefined ? window.screenTop : window.screenY;

  const width = window.innerWidth ? window.innerWidth : document.documentElement.clientWidth ? document.documentElement.clientWidth : screen.width;
  const height = window.innerHeight ? window.innerHeight : document.documentElement.clientHeight ? document.documentElement.clientHeight : screen.height;

  const systemZoom = width / window.screen.availWidth;
  const left = (width - w) / 2 / systemZoom + dualScreenLeft;
  const top = (height - h) / 2 / systemZoom + dualScreenTop;

  const features = `scrollbars=yes,width=${w / systemZoom},height=${h / systemZoom},top=${top},left=${left}`;
  const popup = window.open(url, title, features);
  if (popup) popup.focus();
  return popup;
}

/**
 * 处理当前页面 URL 回调参数
 */
async function handleUrlCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');

  if (code) {
    const session = getSavedPkceSession();
    if (session && (!state || state === session.state)) {
      try {
        await finishLoginWithCode(code, session.codeVerifier, session.redirectUri);
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
      } catch (e: any) {
        MessagePlugin.error(`自动完成授权失败: ${e.message}`);
      }
    }
  }
}

/**
 * 监听 postMessage 授权消息
 */
function handleOAuthMessage(event: MessageEvent) {
  if (event.data && event.data.type === 'LOLIA_OAUTH_CODE') {
    const { code, state } = event.data;
    const session = getSavedPkceSession();
    if (session && (!state || state === session.state)) {
      if (popupWindow.value && !popupWindow.value.closed) {
        popupWindow.value.close();
      }
      void finishLoginWithCode(code, session.codeVerifier, session.redirectUri);
    }
  }
}

/**
 * 窗口获得焦点时检测
 */
function handleWindowFocus() {
  if (popupWindow.value) {
    tryCheckPopupUrl();
  }
}

function tryCheckPopupUrl() {
  if (!popupWindow.value || popupWindow.value.closed) {
    return;
  }
  try {
    const currentHref = popupWindow.value.location.href;
    if (currentHref && currentHref.includes('code=')) {
      const u = new URL(currentHref);
      const code = u.searchParams.get('code');
      const session = getSavedPkceSession();
      if (code && session) {
        stopPolling();
        if (popupWindow.value && !popupWindow.value.closed) {
          popupWindow.value.close();
        }
        void finishLoginWithCode(code, session.codeVerifier, session.redirectUri);
      }
    }
  } catch {
    // 跨域受阻时忽略
  }
}

/**
 * 启动 OAuth 2.0 PKCE 授权
 */
async function startAuthorization() {
  stopPolling();
  isAuthorizing.value = true;
  try {
    const { authUrl } = await createPkceAuthSession(OFFICIAL_REDIRECT_URI);
    popupWindow.value = openLoginPopup(authUrl, 'Lolia FRP 授权登录', 600, 700);

    // 轮询检测弹窗重定向
    pollTimer = window.setInterval(() => {
      if (!popupWindow.value || popupWindow.value.closed) {
        stopPolling();
        return;
      }
      tryCheckPopupUrl();
    }, 400);

    showManualAuthDialog.value = true;
  } catch (err: any) {
    MessagePlugin.error(`启动授权失败: ${err.message || '网络异常'}`);
  } finally {
    isAuthorizing.value = false;
  }
}

/**
 * 换取 Token 并完成登录
 */
async function finishLoginWithCode(code: string, codeVerifier: string, redirectUri = OFFICIAL_REDIRECT_URI) {
  stopPolling();
  loading.value = true;
  try {
    const tokenRes = await exchangeCodeForToken(code, codeVerifier, redirectUri);
    const user: StoredLoliaUser = {
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token,
      accessTokenExpiresAt: tokenRes.expires_in ? Date.now() + tokenRes.expires_in * 1000 : undefined,
      tokenType: tokenRes.token_type || 'Bearer',
    };

    saveStoredLoliaUser(user);
    loliaUser.value = user;
    showManualAuthDialog.value = false;
    manualAuthInput.value = '';

    if (popupWindow.value && !popupWindow.value.closed) {
      popupWindow.value.close();
    }

    await initDashboardData();
    MessagePlugin.success('Lolia FRP 授权登录成功！');
  } catch (err: any) {
    MessagePlugin.error(`换取令牌失败: ${err.message || '授权码无效或已过期'}`);
  } finally {
    loading.value = false;
  }
}

/**
 * 提交授权码、回调 URL 或 Access Token
 */
async function handleManualAuthSubmit() {
  const input = manualAuthInput.value.trim();
  if (!input) {
    MessagePlugin.warning('请输入授权码、回调 URL 或 Access Token');
    return;
  }

  isSubmittingCode.value = true;
  try {
    const session = getSavedPkceSession();

    // 1. 若粘贴的是包含 code= 的完整 URL 或参数
    if (input.includes('code=')) {
      let code = '';
      try {
        const parsed = new URL(input.startsWith('http') ? input : `https://dummy.com/${input.startsWith('?') ? '' : '?'}${input}`);
        code = parsed.searchParams.get('code') || '';
      } catch {
        const match = input.match(/[?&]code=([^&]+)/);
        if (match) code = decodeURIComponent(match[1]);
      }

      if (!code) {
        throw new Error('未能从输入的文本中解析出有效的 code 参数');
      }

      const verifier = session?.codeVerifier || '';
      const redirect = session?.redirectUri || OFFICIAL_REDIRECT_URI;
      await finishLoginWithCode(code, verifier, redirect);
      return;
    }

    // 2. 若直接输入授权码
    if (session && session.codeVerifier) {
      await finishLoginWithCode(input, session.codeVerifier, session.redirectUri);
      return;
    }

    // 3. 直接作为 Access Token
    const directUser: StoredLoliaUser = {
      accessToken: input,
      tokenType: 'Bearer',
    };
    saveStoredLoliaUser(directUser);
    loliaUser.value = directUser;
    showManualAuthDialog.value = false;
    manualAuthInput.value = '';

    if (popupWindow.value && !popupWindow.value.closed) {
      popupWindow.value.close();
    }

    await initDashboardData();
    MessagePlugin.success('Lolia FRP 凭据保存成功！');
  } catch (err: any) {
    MessagePlugin.error(`验证失败: ${err.message || '请重试'}`);
  } finally {
    isSubmittingCode.value = false;
  }
}

/**
 * 初始化用户面板数据
 */
async function initDashboardData(showError = true): Promise<boolean> {
  loading.value = true;
  try {
    const [userData, tunnelList] = await Promise.all([fetchUserInfo(), fetchTunnels()]);

    userInfo.value = userData;
    tunnels.value = tunnelList || [];

    if (loliaUser.value) {
      const mergedUser: StoredLoliaUser = {
        ...loliaUser.value,
        username: userData.username,
        avatar: userData.avatar,
        email: userData.email,
        role: userData.role,
        bandwidthLimit: userData.bandwidth_limit,
        maxTunnelCount: userData.max_tunnel_count,
        trafficLimit: userData.traffic_limit,
        trafficUsed: userData.traffic_used,
        hasKyc: userData.has_kyc,
        kycStatus: userData.kyc_status,
      };
      loliaUser.value = mergedUser;
      saveStoredLoliaUser(mergedUser);
    }

    if (tunnels.value.length === 0) {
      selectedTunnelId.value = null;
    } else if (!tunnels.value.some((item) => item.id === selectedTunnelId.value)) {
      selectedTunnelId.value = tunnels.value[0].id;
    }

    return true;
  } catch (err: any) {
    if (showError) {
      MessagePlugin.error(`获取 Lolia FRP 数据失败: ${err.message || '网络异常'}`);
    }
    return false;
  } finally {
    loading.value = false;
  }
}

async function handleRefresh() {
  const ok = await initDashboardData();
  if (ok) {
    MessagePlugin.success('数据已更新');
  }
}

function handleLogout() {
  stopPolling();
  clearStoredLoliaUser();
  loliaUser.value = null;
  userInfo.value = null;
  tunnels.value = [];
  selectedTunnelId.value = null;
  MessagePlugin.success('已断开 Lolia FRP 授权');
}

const handleAddTunnel = () => {
  showCreateDialog.value = true;
};

const handleCreateSuccess = () => {
  void initDashboardData();
};

async function handleDeleteTunnel() {
  if (!currentTunnel.value) return;
  isDeleting.value = true;

  try {
    await deleteTunnel(currentTunnel.value.name);
    MessagePlugin.success('隧道删除成功');
    selectedTunnelId.value = null;
    await initDashboardData();
  } catch (err: any) {
    MessagePlugin.error(`删除失败: ${err.message || '未知错误'}`);
  } finally {
    isDeleting.value = false;
  }
}

async function handleUseTunnel() {
  if (!currentTunnel.value) return;
  isAddingTunnel.value = true;

  try {
    const configRes = await fetchTunnelConfig(currentTunnel.value.name);
    const rawConfig = configRes.config || configRes.lolia_config || '';
    if (!rawConfig) {
      throw new Error('获取到的隧道配置为空');
    }

    const tomlConfig = convertIniToToml(rawConfig);
    const defaultTunnelName = `${currentTunnel.value.remark || currentTunnel.value.name} | ${currentTunnel.value.node_name} | Lolia FRP`;

    const finalName = await new Promise<string>((resolve, reject) => {
      const inputValue = ref(defaultTunnelName);

      const dialog = DialogPlugin({
        header: '自定义隧道名称',
        body: () =>
          h(Input, {
            value: inputValue.value,
            placeholder: '请输入隧道名称',
            clearable: true,
            onChange: (val: any) => {
              inputValue.value = String(val);
            },
          }),
        onConfirm: () => {
          if (!inputValue.value.trim()) {
            MessagePlugin.warning('隧道名称不能为空');
            return;
          }
          dialog.hide();
          resolve(inputValue.value.trim());
        },
        onClose: () => {
          dialog.hide();
          reject(new Error('cancel'));
        },
        onCancel: () => {
          dialog.hide();
          reject(new Error('cancel'));
        },
      });
    });

    // 传入隧道类型是 Custom 即可
    await request.post({
      url: '/api/frp/add',
      data: {
        name: finalName,
        config: tomlConfig,
        provider: 'Custom',
        format: 'toml',
      },
    });

    MessagePlugin.success('隧道已成功添加到 MSLX！');

    // 刷新宿主 Pinia 状态
    const stores = (window as any).MSLX_Stores;
    const tunnelsStore = stores?.useTunnelsStore?.();
    if (tunnelsStore?.getTunnels) {
      await tunnelsStore.getTunnels();
    }

    // 路由跳转至穿透列表页
    if (globalRouter?.push) {
      globalRouter.push('/frp/list');
    } else {
      // 备用兜底：如果完全拿不到 host 的 router（概率极低），走 origin
      window.location.href = window.location.origin + '/frp/list';
    }
  } catch (err: any) {
    if (err?.message !== 'cancel') {
      MessagePlugin.error(`添加隧道异常: ${err.message || '未知错误'}`);
    }
  } finally {
    isAddingTunnel.value = false;
  }
}
</script>

<template>
  <div class="mx-auto pb-6 text-[var(--td-text-color-primary)]">
    <!-- 未登录状态 -->
    <div v-if="!hasAuth" class="flex items-center justify-center min-h-[70vh] list-item-anim">
      <div
        class="design-card relative w-full max-w-md bg-[var(--td-bg-color-container)] rounded-3xl border border-[var(--td-component-border)] shadow-xl p-10 text-center overflow-hidden"
      >
        <div class="absolute -top-20 -right-20 w-60 h-60 rounded-full blur-3xl pointer-events-none" style="background-color: var(--td-brand-color); opacity: 0.1;"></div>
        <div class="absolute -bottom-10 -left-10 w-40 h-40 rounded-full blur-3xl pointer-events-none" style="background-color: var(--td-brand-color); opacity: 0.1;"></div>

        <div class="relative z-10 flex flex-col items-center">
          <div
            class="w-20 h-20 rounded-2xl flex items-center justify-center mb-6 shadow-sm overflow-hidden p-3"
            style="background-color: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2);"
          >
            <img src="https://lolia.link/favicon.ico" alt="logo" class="w-full h-full object-contain" />
          </div>

          <h2 class="text-2xl font-extrabold text-[var(--td-text-color-primary)] !mb-2 tracking-tight">
            登录 Lolia FRP
          </h2>
          <p class="text-sm text-[var(--td-text-color-secondary)] !mb-6 font-medium">
            登录授权您的 Lolia Frp 账号即可开始使用。
          </p>

          <div class="w-full flex flex-col gap-3">
            <div class="w-full">
              <t-button
                block
                theme="primary"
                size="large"
                :loading="isAuthorizing"
                class="!w-full !rounded-xl !h-12 !font-bold shadow-md hover:shadow-lg !m-0 !ml-0"
                @click="startAuthorization"
              >
                <template #icon><user-circle-icon /></template>
                授权登录
              </t-button>
            </div>

            <div class="w-full mt-1">
              <t-input
                v-model="manualAuthInput"
                placeholder="若未自动识别，可在此粘贴回调地址或Code"
                size="large"
                clearable
                class="!rounded-xl text-left"
                @enter="handleManualAuthSubmit"
              >
                <template #prefix-icon><link-icon class="opacity-60" /></template>
              </t-input>
            </div>

            <div v-if="manualAuthInput" class="w-full">
              <t-button
                block
                theme="default"
                variant="outline"
                size="large"
                :loading="isSubmittingCode"
                class="!w-full !rounded-xl !h-10 !font-bold !m-0 !ml-0"
                @click="handleManualAuthSubmit"
              >
                完成授权
              </t-button>
            </div>
          </div>

          <div class="mt-6 pt-4 border-t border-dashed border-[var(--td-component-border)] w-full flex justify-center">
            <t-button
              variant="text"
              size="small"
              class="text-zinc-500 hover:text-[var(--td-brand-color)] !m-0"
              @click="openUrl('https://dash.lolia.link')"
            >
              前往 Lolia FRP 控制台
            </t-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 已登录控制台界面 -->
    <div v-else id="app-space" class="relative flex flex-col gap-6">
      <t-loading attach="#app-space" :loading="loading" text="加载数据中..." />

      <!-- 用户信息概览卡片 -->
      <div
        v-if="userInfo"
        class="design-card list-item-anim bg-[var(--td-bg-color-container)] rounded-2xl border border-[var(--td-component-border)] shadow-sm p-5 sm:p-6"
        style="animation-delay: 0s"
      >
        <div
          class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-dashed border-[var(--td-component-border)]"
        >
          <div class="flex items-center gap-3">
            <t-avatar :image="userInfo.avatar" size="medium" shape="circle" class="!rounded-full overflow-hidden border border-[var(--td-component-border)]" />
            <div class="flex flex-col">
              <h3 class="text-lg font-bold text-[var(--td-text-color-primary)] m-0 leading-none">
                {{ userInfo.username }}
              </h3>
              <span class="text-xs text-zinc-500 mt-1">{{ userInfo.email || 'Lolia FRP 账户' }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <t-tag
              v-if="userInfo.has_kyc"
              theme="success"
              variant="light-outline"
              class="!rounded-md !font-bold"
            >已实名</t-tag>
            <t-tag
              theme="primary"
              variant="light-outline"
              class="!rounded-md !font-bold"
            >{{ userInfo.role || '用户' }}</t-tag>
            <div class="w-px h-4 bg-[var(--td-component-border)] mx-1"></div>
            <t-popconfirm content="确认断开与 Lolia FRP 的授权吗？" @confirm="handleLogout">
              <t-button variant="text" theme="danger" size="small" class="!rounded-lg hover:!bg-red-50 dark:hover:!bg-red-900 !m-0 !ml-0">
                退出登录
              </t-button>
            </t-popconfirm>
          </div>
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="p-4 rounded-xl transition-colors hover:bg-white dark:hover:bg-zinc-800" style="background: rgba(244, 244, 245, 0.8); border: 1px solid rgba(228, 228, 231, 0.8);">
            <div class="text-[11px] font-extrabold text-[var(--td-text-color-secondary)] uppercase tracking-widest mb-1">
              用户名称
            </div>
            <div class="text-lg font-bold text-[var(--td-text-color-primary)] truncate">{{ userInfo.username }}</div>
          </div>

          <div class="p-4 rounded-xl transition-colors hover:bg-white dark:hover:bg-zinc-800" style="background: rgba(244, 244, 245, 0.8); border: 1px solid rgba(228, 228, 231, 0.8);">
            <div class="text-[11px] font-extrabold text-[var(--td-text-color-secondary)] uppercase tracking-widest mb-1">
              隧道配额
            </div>
            <div class="text-lg font-bold text-[var(--td-text-color-primary)] font-mono">
              <span class="text-[var(--td-brand-color)]">{{ tunnels.length }}</span> / {{ userInfo.max_tunnel_count }}
              <span class="text-sm font-medium text-zinc-500">条</span>
            </div>
          </div>

          <div class="p-4 rounded-xl transition-colors hover:bg-white dark:hover:bg-zinc-800" style="background: rgba(244, 244, 245, 0.8); border: 1px solid rgba(228, 228, 231, 0.8);">
            <div class="text-[11px] font-extrabold text-[var(--td-text-color-secondary)] uppercase tracking-widest mb-1">
              带宽限制
            </div>
            <div class="text-lg font-bold text-[var(--td-text-color-primary)] font-mono">
              {{ userInfo.bandwidth_limit * 8 }} <span class="text-sm font-medium text-zinc-500">Mbps</span>
            </div>
          </div>

          <div class="p-4 rounded-xl transition-colors hover:bg-white dark:hover:bg-zinc-800" style="background: rgba(244, 244, 245, 0.8); border: 1px solid rgba(228, 228, 231, 0.8);">
            <div class="text-[11px] font-extrabold text-[var(--td-text-color-secondary)] uppercase tracking-widest mb-1">
              流量统计
            </div>
            <div class="text-sm font-bold text-[var(--td-warning-color,#ed7b2f)] font-mono mt-1">
              {{ formatBytes(userInfo.traffic_used) }} / {{ formatBytes(userInfo.traffic_limit) }}
            </div>
          </div>
        </div>
      </div>

      <!-- 隧道管理网格 -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <!-- 左侧：隧道列表 -->
        <div
          class="lg:col-span-5 xl:col-span-4 design-card list-item-anim flex flex-col bg-[var(--td-bg-color-container)] rounded-2xl border border-[var(--td-component-border)] shadow-sm h-[580px]"
          style="animation-delay: 0.1s"
        >
          <div
            class="flex items-center justify-between p-4 sm:p-5 border-b border-dashed border-[var(--td-component-border)] shrink-0"
          >
            <h3 class="text-base font-bold text-[var(--td-text-color-primary)] m-0">我的隧道</h3>
            <div class="flex items-center gap-1">
              <t-button
                size="small"
                variant="text"
                class="!px-2 !m-0 !ml-0"
                :loading="loading"
                @click="handleRefresh"
              >
                <template #icon><refresh-icon /></template>刷新
              </t-button>
              <t-button size="small" theme="primary" class="!px-3 !ml-1 !rounded-lg" @click="handleAddTunnel">
                <template #icon><add-icon /></template>新建
              </t-button>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto custom-scrollbar p-3">
            <div v-if="tunnels.length > 0" class="flex flex-col gap-2">
              <div
                v-for="tunnel in tunnels"
                :key="tunnel.id"
                class="group flex items-center p-3 rounded-xl cursor-pointer transition-all duration-200 border"
                :class="
                  selectedTunnelId === tunnel.id
                    ? 'selected-tunnel-item'
                    : 'unselected-tunnel-item'
                "
                @click="selectedTunnelId = tunnel.id"
              >
                <div
                  class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mr-3 transition-colors"
                  :class="
                    selectedTunnelId === tunnel.id
                      ? 'bg-[var(--td-brand-color)] text-white'
                      : 'bg-[var(--td-bg-color-secondarycontainer)] text-[var(--td-text-color-secondary)]'
                  "
                >
                  <server-icon size="20px" />
                </div>
                <div class="flex-1 min-w-0 mr-3">
                  <div
                    class="font-bold text-sm truncate transition-colors"
                    :class="
                      selectedTunnelId === tunnel.id
                        ? 'text-[var(--td-brand-color)]'
                        : 'text-[var(--td-text-color-primary)]'
                    "
                  >
                    {{ tunnel.remark || tunnel.name }}
                  </div>
                  <div class="text-[11px] text-[var(--td-text-color-secondary)] truncate mt-0.5">
                    {{ tunnel.node_name }} · {{ tunnel.type.toUpperCase() }}
                  </div>
                </div>
                <div class="shrink-0">
                  <t-tag
                    v-if="isTunnelOnline(tunnel)"
                    theme="success"
                    variant="light"
                    size="small"
                    class="!rounded !font-bold !px-1.5"
                  >在线</t-tag>
                  <t-tag
                    v-else
                    theme="default"
                    variant="light"
                    size="small"
                    class="!rounded !font-bold !px-1.5 !text-zinc-500"
                  >离线</t-tag>
                </div>
              </div>
            </div>

            <div v-else class="h-full flex flex-col items-center justify-center opacity-60">
              <server-icon size="32px" class="text-zinc-400 mb-2" />
              <span class="text-sm text-zinc-500 font-medium">暂无隧道，请先新建</span>
            </div>
          </div>
        </div>

        <!-- 右侧：隧道详情 -->
        <div
          class="lg:col-span-7 xl:col-span-8 design-card list-item-anim flex flex-col bg-[var(--td-bg-color-container)] rounded-2xl border border-[var(--td-component-border)] shadow-sm h-[580px]"
          style="animation-delay: 0.2s"
        >
          <template v-if="currentTunnel">
            <div
              class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 sm:p-6 border-b border-dashed border-[var(--td-component-border)] shrink-0"
            >
              <div class="flex flex-col min-w-0">
                <h3 class="text-xl font-extrabold text-[var(--td-text-color-primary)] m-0 truncate">
                  {{ currentTunnel.remark || currentTunnel.name }}
                </h3>
                <p
                  class="text-xs text-[var(--td-text-color-secondary)] mt-1 truncate font-mono bg-[var(--td-bg-color-secondarycontainer)] w-max px-2 py-0.5 rounded border border-[var(--td-component-border)]"
                >
                  名称: {{ currentTunnel.name }}
                </p>
              </div>
              <div class="shrink-0">
                <t-popconfirm
                  content="确认删除此隧道吗？操作将不可恢复！"
                  theme="danger"
                  placement="bottom-right"
                  @confirm="handleDeleteTunnel"
                >
                  <t-button
                    theme="danger"
                    class="!rounded-lg hover:!bg-red-500 hover:!text-white transition-colors !m-0 !ml-0"
                    :loading="isDeleting"
                  >
                    <template #icon><delete-icon /></template>
                    删除隧道
                  </t-button>
                </t-popconfirm>
              </div>
            </div>

            <div class="flex-1 overflow-y-auto custom-scrollbar p-5 sm:p-6">
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
                <div class="stat-card p-4 rounded-xl flex flex-col justify-center">
                  <span class="text-[11px] font-extrabold text-[var(--td-text-color-secondary)] uppercase tracking-widest mb-1.5">
                    所在节点
                  </span>
                  <span class="text-sm font-bold text-[var(--td-text-color-primary)] truncate" :title="currentTunnel.node_name">
                    {{ currentTunnel.node_name }}
                  </span>
                </div>

                <div class="stat-card p-4 rounded-xl flex flex-col justify-center">
                  <span class="text-[11px] font-extrabold text-[var(--td-text-color-secondary)] uppercase tracking-widest mb-1.5">
                    协议与本地地址
                  </span>
                  <span class="text-sm font-mono font-bold text-[var(--td-text-color-primary)]">
                    <span class="text-[var(--td-brand-color)] font-sans uppercase font-extrabold mr-1">{{ currentTunnel.type }}</span>
                    {{ currentTunnel.local_ip }}:{{ currentTunnel.local_port }}
                  </span>
                </div>

                <div
                  class="p-4 bg-[var(--td-success-color-light,#e8f8f2)] dark:bg-emerald-900 rounded-xl border border-[var(--td-success-color-focus,#9ae6b4)] flex flex-col justify-center"
                >
                  <span class="text-[11px] font-extrabold text-[var(--td-success-color,#2ba471)] uppercase tracking-widest mb-1.5">
                    远程端口 / 域名
                  </span>
                  <span class="text-lg font-mono font-extrabold text-[var(--td-success-color,#2ba471)]">
                    {{ currentTunnel.custom_domain || currentTunnel.remote_port }}
                  </span>
                </div>

                <div
                  class="stat-card p-4 rounded-xl flex flex-col justify-center"
                >
                  <span class="text-[11px] font-extrabold uppercase tracking-widest mb-1.5 text-[var(--td-text-color-secondary)]">
                    当前状态
                  </span>
                  <div class="flex items-center gap-2">
                    <span
                      v-if="isTunnelOnline(currentTunnel)"
                      class="w-2 h-2 rounded-full bg-[var(--td-success-color,#2ba471)] animate-pulse"
                    ></span>
                    <span
                      class="text-sm font-bold"
                      :class="
                        isTunnelOnline(currentTunnel)
                          ? 'text-[var(--td-success-color,#2ba471)]'
                          : 'text-zinc-500'
                      "
                    >
                      {{ isTunnelOnline(currentTunnel) ? '节点在线' : '离线' }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="mt-8">
                <t-button
                  theme="primary"
                  size="large"
                  :loading="isAddingTunnel"
                  block
                  class="!w-full !rounded-xl !h-12 !font-bold shadow-md shadow-[var(--td-brand-color-light)] text-base !m-0 !ml-0"
                  @click="handleUseTunnel"
                >
                  <template #icon><play-circle-icon /></template>
                  使用此隧道
                </t-button>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="flex-1 flex flex-col items-center justify-center opacity-50 p-6 text-center">
              <div class="w-20 h-20 bg-[var(--td-bg-color-secondarycontainer)] rounded-full flex items-center justify-center mb-4">
                <cloud-icon size="36px" class="text-zinc-400" />
              </div>
              <h3 class="text-base font-bold text-zinc-700 dark:text-zinc-300 mb-1">未选择隧道</h3>
              <p class="text-xs text-zinc-500">请在左侧列表中选择一个隧道以查看详细信息</p>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 新建隧道弹窗 -->
    <create-tunnel-dialog
      v-if="showCreateDialog"
      v-model:visible="showCreateDialog"
      @success="handleCreateSuccess"
    />

    <!-- 手动授权码/回调输入弹窗 -->
    <t-dialog
      v-model:visible="showManualAuthDialog"
      header="Lolia FRP 授权引导"
      width="540px"
      :confirm-btn="{ content: '完成授权登录', loading: isSubmittingCode }"
      @confirm="handleManualAuthSubmit"
    >
      <div class="space-y-3 pt-2 text-left">
        <div class="p-3 bg-[var(--td-bg-color-secondarycontainer)] rounded-lg text-xs leading-relaxed text-[var(--td-text-color-secondary)]">
          <p class="font-bold text-[var(--td-text-color-primary)] mb-1">📌 授权操作指引：</p>
          <p>1. 浏览器已打开官方授权页面，请在授权页面确认授权。</p>
          <p>2. 授权成功后将自动回调；若未自动完成，可复制地址栏中的<strong>完整网址</strong>或 <strong>code 授权码</strong>粘贴至下方（粘贴后将自动识别登录）：</p>
        </div>

        <t-textarea
          v-model="manualAuthInput"
          placeholder="在此粘贴形如 https://mslx.mslmc.cn/?code=xxxxxx 的完整地址，或直接输入 code 授权码 / Token"
          :autosize="{ minRows: 3, maxRows: 5 }"
        />
      </div>
    </t-dialog>
  </div>
</template>

<style scoped lang="less">
:deep(.t-button) {
  margin-left: 0 !important;
  margin-right: 0 !important;
}

:deep(.t-button + .t-button) {
  margin-left: 0 !important;
}

.stat-card {
  background: rgba(244, 244, 245, 0.7);
  border: 1px solid rgba(228, 228, 231, 0.8);
  &:hover {
    background: rgba(255, 255, 255, 0.95);
  }
}

:global(.dark) .stat-card {
  background: rgba(24, 24, 27, 0.4);
  border: 1px solid rgba(39, 39, 42, 0.8);
  &:hover {
    background: rgba(39, 39, 42, 0.6);
  }
}

.selected-tunnel-item {
  background: var(--td-brand-color-light);
  border-color: var(--td-brand-color-focus);
}

.unselected-tunnel-item {
  background: transparent;
  border-color: transparent;
  &:hover {
    background: var(--td-bg-color-secondarycontainer);
    border-color: var(--td-component-border);
  }
}

/* 首次渲染滑入动画 */
.list-item-anim {
  animation: slideUp 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes smoothLoadingGlass {
  from {
    backdrop-filter: blur(0.01px);
    -webkit-backdrop-filter: blur(0.01px);
  }
  to {
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
}

.custom-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: rgba(150, 150, 150, 0.3) transparent;

  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(150, 150, 150, 0.3);
    border-radius: 3px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }
}

:deep(.t-loading__overlay) {
  border-radius: 1rem !important;
  background: rgba(255, 255, 255, 0.6) !important;
  animation: smoothLoadingGlass 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards !important;
}

:global(.dark) :deep(.t-loading__overlay) {
  background: rgba(24, 24, 27, 0.6) !important;
}
</style>
