import { useTheme } from '../../components/theme';
import { useLanguage } from '../language/LanguageProvider';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { TerminalSession } from './session';
import { terminalHtml } from './terminalHtml';

const terminalSource = { html: terminalHtml };

export function TerminalView({ session, onFailure }: { session: TerminalSession; onFailure(): void }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const web = useRef<WebView>(null);
  const acknowledge = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.termixTheme(${JSON.stringify({ background: colors.terminal, foreground: colors.terminalText, cursor: colors.terminalText })});true;`);
  }, [ready, colors]);
  useEffect(() => {
    if (ready) return;
    const timeout = setTimeout(onFailure, 10_000);
    return () => clearTimeout(timeout);
  }, [ready, onFailure]);
  useEffect(() => {
    if (!ready) return;
    const pending: string[] = [];
    let queued = 0;
    let inFlight = false;
    let stopped = false;
    const pump = () => {
      if (inFlight || !pending.length || stopped) return;
      inFlight = true;
      web.current?.injectJavaScript(`window.termixWrite(${JSON.stringify(pending[0])});true;`);
    };
    acknowledge.current = () => {
      if (!inFlight) return;
      queued -= pending.shift()!.length;
      inFlight = false;
      pump();
    };
    const write = (data: string) => {
      if (stopped || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return;
      if (queued + data.length > 700_000) { stopped = true; onFailure(); return; }
      queued += data.length;
      pending.push(data);
      pump();
    };
    session.getOutput().forEach(write);
    const unsubscribe = session.subscribeOutput(write);
    return () => { stopped = true; acknowledge.current = () => {}; unsubscribe(); };
  }, [session, ready, onFailure]);
  return <View style={[styles.frame, { backgroundColor: colors.terminal }]} accessibilityLabel={t("SSH 終端輸出")}>
    <WebView ref={web} source={terminalSource} style={{ backgroundColor: colors.terminal }} originWhitelist={['*']}
      scrollEnabled={false} bounces={false} automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never"
      incognito domStorageEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
      allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      javaScriptCanOpenWindowsAutomatically={false} setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
      onError={onFailure} onContentProcessDidTerminate={onFailure} onRenderProcessGone={onFailure}
      onMessage={event => {
        try {
          const message = JSON.parse(event.nativeEvent.data);
          if (message.type === 'written') acknowledge.current();
          if (message.type === 'tap') { Keyboard.dismiss(); return; }
          if (message.type === 'ready') setReady(true);
          if (message.type === 'resize') void session.resize(message.cols, message.rows);
          if (message.type === 'input' && typeof message.data === 'string') void session.send(message.data);
        } catch { /* 忽略不符合終端橋接協定的訊息。 */ }
      }} />
  </View>;
}
const styles = StyleSheet.create({ frame: { flex: 1, minHeight: 0 } });
