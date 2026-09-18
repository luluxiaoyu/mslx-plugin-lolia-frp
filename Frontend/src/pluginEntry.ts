import LoliaFrpProvider from './views/LoliaFrpProvider.vue';
import './style.css';

export const pluginConfig = {
  name: 'MSLX.Plugin.Lolia.Frp',
  version: '0.0.10',

  // 注入穿透服务商插槽
  extensions: [
    {
      slot: 'frp-create-provider',
      component: LoliaFrpProvider,
      label: 'Lolia FRP',
    },
  ],
};
