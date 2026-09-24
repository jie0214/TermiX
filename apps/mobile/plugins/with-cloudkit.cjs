const { withEntitlementsPlist } = require('expo/config-plugins');
const withDocumentPicker = require('expo-document-picker/app.plugin').default;

module.exports = (config, { container, environment }) => {
  // Expo 的 mod 以反向註冊順序執行；最後註冊檔案選擇器，讓它先執行。
  config = withEntitlementsPlist(config, (config) => {
    config.modResults['com.apple.developer.icloud-container-identifiers'] = [container];
    config.modResults['com.apple.developer.icloud-services'] = ['CloudKit'];
    config.modResults['com.apple.developer.icloud-container-environment'] = environment;
    return config;
  });
  return withDocumentPicker(config);
};
