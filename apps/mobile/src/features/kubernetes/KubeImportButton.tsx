import { router } from 'expo-router';
import { SettingsRow } from '../../components/SettingsList';
import { useLanguage } from '../language/LanguageProvider';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { useTheme } from '../../components/theme';
import { pickKubeconfig } from '../../storage/kubeconfig';
import { useKubernetes } from './KubernetesProvider';

export function KubeImportButton({ presentation = 'button', compact = false }: { presentation?: 'button' | 'row'; compact?: boolean }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const { workspace, state } = useKubernetes();
  const [picking, setPicking] = useState(false); const [pickError, setPickError] = useState('');
  const pick = async () => {
    if (picking) return;
    setPicking(true); setPickError('');
    try { const raw = await pickKubeconfig(); if (raw !== null) await workspace.import(raw); }
    catch { setPickError('無法讀取 kubeconfig，請選擇 256 KB 以內的檔案。'); }
    finally { setPicking(false); }
  };
  const Control = presentation === 'row' ? SettingsRow : Button;
  return <View style={{ gap: presentation === 'row' ? 0 : 8 }}>
    <Control {...(presentation === 'row' ? { icon: 'box' as const } : {})} label={picking || state.status === 'loading' ? t("匯入中…") : t("匯入 kubeconfig")} disabled={picking || state.status === 'loading'} onPress={() => void pick()} />
    {!compact && !!state.profile && <Text style={{ color: colors.muted, fontSize: 14, marginHorizontal: presentation === 'row' ? 16 : 0, marginVertical: 6 }}>{state.profile.cluster} · {state.profile.context}</Text>}
    {!compact && !!state.profile?.eks && <Button variant="secondary" label={t('設定雲端帳號：{name}', { name: state.profile.eks.profile })} onPress={() => router.push('/settings/aws')} />}
    {!!pickError && <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14, marginHorizontal: presentation === 'row' ? 16 : 0, marginVertical: 6 }}>{t(pickError)}</Text>}
    {!!state.message && <Text accessibilityRole="alert" style={{ color: state.status === 'error' ? colors.danger : colors.muted, fontSize: 14, marginHorizontal: presentation === 'row' ? 16 : 0, marginVertical: 6 }}>{t(state.message)}</Text>}
  </View>;
}
