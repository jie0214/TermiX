// 只有完成 Apple 容器及簽章設定的建置才啟用 CloudKit。
export default ({ config }) => {
  const container = process.env.TERMIX_ICLOUD_CONTAINER;
  if (process.env.TERMIX_APPLE_RELEASE === '1' && (!container || process.env.TERMIX_ICLOUD_ENVIRONMENT !== 'Production')) {
    throw new Error('Apple 正式發佈必須設定 CloudKit 容器與 Production 環境');
  }
  if (!container) return config;
  if (!/^iCloud\.[A-Za-z0-9.-]+$/.test(container)) throw new Error('TERMIX_ICLOUD_CONTAINER 格式錯誤');
  const environment = process.env.TERMIX_ICLOUD_ENVIRONMENT || 'Development';
  if (!['Development', 'Production'].includes(environment)) throw new Error('CloudKit 環境必須為 Development 或 Production');
  return { ...config, plugins: [...(config.plugins || []), ['./plugins/with-cloudkit.cjs', { container, environment }]], ios: { ...config.ios,
    infoPlist: { ...config.ios?.infoPlist, TermixCloudKitContainer: container, TermixCloudKitEnvironment: environment },
    entitlements: { ...config.ios?.entitlements,
      'com.apple.developer.icloud-container-identifiers': [container],
      'com.apple.developer.icloud-services': ['CloudKit'],
      'com.apple.developer.icloud-container-environment': environment,
    },
  } };
};
