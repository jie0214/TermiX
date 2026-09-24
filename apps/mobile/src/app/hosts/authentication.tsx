import { useLanguage } from '../../features/language/LanguageProvider';
import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { useHosts } from '../../features/hosts/HostProvider';
import { HostForm } from '../../features/hosts/HostForm';
import { Button } from '../../components/Button';
export default function HostAuthentication() {
  const { t } = useLanguage();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { hosts } = useHosts();
  // 固定進入畫面的目標；保存時由儲存服務核對同步是否已改變目標。
  const [host] = useState(() => hosts.find(item => item.id === id && item.authType === 'unconfigured'));
  if (!host) return <><Text>{t("主機已變更，請返回後重試。")}</Text><Button label={t("返回主機")} onPress={() => router.back()} /></>;
  return <HostForm existing={host} onSaved={() => router.back()} onCancel={() => router.back()} />;
}
