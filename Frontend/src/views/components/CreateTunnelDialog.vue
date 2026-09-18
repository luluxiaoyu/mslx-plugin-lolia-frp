<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import { createTunnel, fetchNodes, type LoliaNode } from '../../api/lolia';
import { generateRandomString } from '../../api/auth';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'success'): void;
}>();

const loading = ref(false);
const submitting = ref(false);
const nodes = ref<LoliaNode[]>([]);

const form = reactive({
  nodeId: null as number | null,
  type: 'tcp',
  localIp: '127.0.0.1',
  localPort: '25565',
  remotePort: '',
  customDomain: '',
  remark: '',
});

const selectedNode = computed(() => nodes.value.find((n) => n.id === form.nodeId) || null);

const availableProtocols = computed(() => {
  if (selectedNode.value && selectedNode.value.supported_protocols && selectedNode.value.supported_protocols.length > 0) {
    return selectedNode.value.supported_protocols.map((p) => p.toLowerCase());
  }
  return ['tcp', 'udp', 'http', 'https'];
});

const generateRandomData = () => {
  form.remark = 'MSLX_' + generateRandomString(6);
  if (form.type === 'tcp' || form.type === 'udp') {
    form.remotePort = (Math.floor(Math.random() * (65535 - 10000 + 1)) + 10000).toString();
  }
};

const loadNodes = async () => {
  loading.value = true;
  try {
    const list = await fetchNodes();
    nodes.value = list || [];
    if (nodes.value.length > 0 && form.nodeId === null) {
      const onlineNode = nodes.value.find((n) => n.status === 'online') || nodes.value[0];
      form.nodeId = onlineNode.id;
      generateRandomData();
    }
  } catch (err: any) {
    MessagePlugin.error(`加载节点列表失败: ${err.message || '网络异常'}`);
  } finally {
    loading.value = false;
  }
};

watch(
  () => props.visible,
  (val) => {
    if (val) {
      if (nodes.value.length === 0) {
        loadNodes();
      } else {
        generateRandomData();
      }
    }
  }
);

watch(
  () => form.type,
  (newType) => {
    if (newType === 'http' || newType === 'https') {
      form.remotePort = newType === 'http' ? '80' : '443';
    } else if (!form.remotePort || form.remotePort === '80' || form.remotePort === '443') {
      form.remotePort = (Math.floor(Math.random() * (65535 - 10000 + 1)) + 10000).toString();
    }
  }
);

const handleConfirm = async () => {
  if (!form.nodeId) {
    MessagePlugin.warning('请选择一个节点');
    return;
  }
  if (!form.localIp || !form.localPort) {
    MessagePlugin.warning('请填写完整的本地映射地址');
    return;
  }
  if ((form.type === 'http' || form.type === 'https') && !form.customDomain.trim()) {
    MessagePlugin.warning('HTTP/HTTPS 穿透必须填写自定义域名');
    return;
  }

  const localPortNum = parseInt(form.localPort, 10);
  const remotePortNum = parseInt(form.remotePort, 10) || 0;

  if (isNaN(localPortNum) || localPortNum <= 0 || localPortNum > 65535) {
    MessagePlugin.warning('本地端口格式不正确 (1-65535)');
    return;
  }

  submitting.value = true;
  try {
    await createTunnel({
      node_id: form.nodeId,
      type: form.type.toLowerCase(),
      local_ip: form.localIp.trim(),
      local_port: localPortNum,
      remote_port: remotePortNum,
      custom_domain: form.customDomain.trim(),
      remark: form.remark.trim() || 'MSLX 隧道',
    });

    MessagePlugin.success(`隧道 ${form.remark || 'Lolia FRP'} 创建成功！`);
    emit('success');
    emit('update:visible', false);
  } catch (err: any) {
    MessagePlugin.error(`创建隧道失败: ${err.message || '请检查配置或节点状态'}`);
  } finally {
    submitting.value = false;
  }
};

onMounted(() => {
  if (props.visible) {
    loadNodes();
  }
});
</script>

<template>
  <t-dialog
    attach="body"
    :visible="visible"
    header="新建 Lolia FRP 隧道"
    width="580px"
    :confirm-btn="{ content: '提交创建', loading: submitting }"
    @confirm="handleConfirm"
    @close="emit('update:visible', false)"
  >
    <t-loading :loading="loading">
      <t-form
        :data="form"
        label-align="right"
        :label-width="100"
        class="pt-2.5 overflow-x-hidden [&_.t-form__item]:!mb-[22px]"
      >
        <t-form-item label="选择节点" name="nodeId">
          <t-select
            v-model="form.nodeId"
            placeholder="请选择节点"
            :popup-props="{ overlayClassName: 'max-h-[300px]' }"
            @change="generateRandomData"
          >
            <t-option
              v-for="node in nodes"
              :key="node.id"
              :value="node.id"
              :label="node.name"
            >
              <div class="flex justify-between items-center w-full">
                <span class="truncate">{{ node.name }}</span>
                <div class="flex items-center gap-1.5 shrink-0 ml-2">
                  <t-tag
                    v-if="node.status === 'online'"
                    theme="success"
                    variant="light"
                    size="small"
                    class="!text-[10px] !px-1"
                  >在线</t-tag>
                  <t-tag
                    v-else
                    theme="default"
                    variant="light"
                    size="small"
                    class="!text-[10px] !px-1"
                  >离线</t-tag>
                  <span class="text-xs text-zinc-400 font-mono">{{ node.region_code }}</span>
                </div>
              </div>
            </t-option>
          </t-select>
        </t-form-item>

        <t-form-item v-if="selectedNode" label="节点详情">
          <div class="w-full flex flex-col gap-2">
            <div
              class="bg-[var(--td-bg-color-secondarycontainer)] rounded-[var(--td-radius-medium)] p-3 border border-dashed border-[var(--td-component-border)] text-xs space-y-1"
            >
              <div class="flex justify-between">
                <span class="text-zinc-500">带宽限制:</span>
                <span class="font-bold text-[var(--td-text-color-primary)]">{{ selectedNode.bandwidth }} Mbps</span>
              </div>
              <div v-if="selectedNode.remark" class="text-zinc-500">
                <span>备注: </span>
                <span class="text-[var(--td-text-color-primary)]">{{ selectedNode.remark }}</span>
              </div>
            </div>
          </div>
        </t-form-item>

        <t-form-item label="隧道类型" name="type">
          <t-radio-group v-model="form.type" variant="default-filled">
            <t-radio-button
              v-for="p in availableProtocols"
              :key="p"
              :value="p"
            >
              {{ p.toUpperCase() }}
            </t-radio-button>
          </t-radio-group>
        </t-form-item>

        <t-form-item label="隧道备注" name="remark">
          <t-input v-model="form.remark" placeholder="请输入隧道备注或用途" />
        </t-form-item>

        <t-row :gutter="[16, 20]">
          <t-col :xs="12" :sm="6">
            <t-form-item label="本地 IP" name="localIp">
              <t-input v-model="form.localIp" placeholder="127.0.0.1" />
            </t-form-item>
          </t-col>
          <t-col :xs="12" :sm="6">
            <t-form-item label="本地端口" name="localPort">
              <t-input v-model="form.localPort" placeholder="25565" />
            </t-form-item>
          </t-col>
          <t-col v-if="form.type === 'tcp' || form.type === 'udp'" :xs="12" :sm="12">
            <t-form-item label="远程端口" name="remotePort">
              <t-input v-model="form.remotePort" placeholder="留空或点击随机分配">
                <template #suffix>
                  <t-button variant="text" size="small" @click="generateRandomData">随机</t-button>
                </template>
              </t-input>
            </t-form-item>
          </t-col>
          <t-col v-if="form.type === 'http' || form.type === 'https'" :xs="12" :sm="12">
            <t-form-item label="自定义域名" name="customDomain">
              <t-input v-model="form.customDomain" placeholder="example.yourdomain.com" />
            </t-form-item>
          </t-col>
        </t-row>
      </t-form>
    </t-loading>
  </t-dialog>
</template>

<style scoped></style>
