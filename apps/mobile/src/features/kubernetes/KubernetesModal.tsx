import { Modal, type ModalProps } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../components/theme';

/** 目前 React Native／iOS 組合的 pageSheet 關閉後會殘留空白原生視窗，統一使用全螢幕呈現。 */
export function KubernetesModal({ children, ...props }: Omit<ModalProps, 'presentationStyle'>) {
  const { colors } = useTheme();
  return <Modal {...props} presentationStyle="fullScreen">
    <SafeAreaProvider>
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {children}
    </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}
