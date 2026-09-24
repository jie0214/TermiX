import { useLanguage } from '../../features/language/LanguageProvider';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { HostList } from '../../features/hosts/HostList';
import type { Host } from '../../features/hosts/repository';
import { useTerminal } from '../../features/terminal/TerminalProvider';

export default function Hosts() {
  const { t } = useLanguage();
  const { session, state } = useTerminal();
  const connect = (host: Host) => {
    if (host.authType === 'unconfigured') { router.push({ pathname: '/hosts/authentication', params: { id: host.id } }); return; }
    const open = () => { router.navigate('/terminal'); void session.connect(host); };
    if (['connecting', 'trust', 'connected', 'closing'].includes(state.status)) {
      if (state.host?.id === host.id) { router.navigate('/terminal'); return; }
      if (state.status === 'closing') return;
      Alert.alert(t('切換主機？'), t('將中斷 {name} 的連線。', { name: state.host?.name ?? t('目前主機') }), [
        { text: t('取消'), style: 'cancel' },
        { text: t('中斷並連線'), onPress: () => { void session.disconnect().then(open); } },
      ]);
      return;
    }
    open();
  };
  return <HostList onAdd={folderPath => router.push({ pathname: '/hosts/new', params: { folder: JSON.stringify(folderPath) } })} onConnect={connect} />;
}
