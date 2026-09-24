import { StyleSheet, Text, View } from 'react-native';
import { useTheme, useThemedStyles, type ThemeColors } from '../../components/theme';
import { useLanguage } from '../language/LanguageProvider';
import type { LimitValue, PodLimits, PodMetrics } from './workspace';
export function usageAmount(value:number) {return value>0 && value<0.01?'<0.01':String(Number(value.toFixed(2)));}
export function UsageMeter({label,used,limit,unit,compact=false,partial=false}:{label:string;used?:number;limit?:LimitValue;unit:string;compact?:boolean;partial?:boolean}) {
 const {colors,dark}=useTheme();const styles=useThemedStyles(createStyles);const {t}=useLanguage();
 const known=used!==undefined && Number.isFinite(used) && used>=0;
 const maximum=limit?.state==='set' && typeof limit.value==='number' && Number.isFinite(limit.value) && limit.value>0?limit.value:undefined;
 const ratio=known && maximum && !partial?used/maximum:undefined;
 const percent=ratio===undefined?undefined:ratio*100;
 const color=percent!==undefined && percent>=90?colors.danger:percent!==undefined && percent>=70?(dark?'#f2bf66':'#805600'):colors.accent;
 const value=known?usageAmount(used):'—';
 const upper=maximum?`${usageAmount(maximum)} ${unit}`:t(limit?.state==='unset'?'未設定上限':'上限未知');
 const summary=`${value}${maximum?'':` ${unit}`} / ${upper}`;
 return <View style={styles.meter}>
  <View style={styles.line}><Text style={compact?styles.small:styles.label}>{label}</Text><Text style={[compact?styles.small:styles.percent,{color}]}>{percent===undefined?(partial?t('部分用量'):'—'):percent>0 && percent<0.1?'<0.1%':`${Number(percent.toFixed(1))}%`}</Text></View>
  <Text numberOfLines={compact?1:2} adjustsFontSizeToFit={compact} style={compact?styles.small:styles.value}>{summary}</Text>
  <View accessible accessibilityRole="progressbar" accessibilityLabel={`${label} ${summary}`} accessibilityValue={percent===undefined?{text:partial?t('部分用量'):upper}:{min:0,max:100,now:Math.min(percent,100),text:`${Number(percent.toFixed(1))}%`}} style={styles.track}>
   {percent!==undefined && <View style={{height:'100%',width:`${Math.min(percent,100)}%`,backgroundColor:color,borderRadius:4}}/>}
  </View>
  {!compact && limit?.scope && <Text style={styles.small}>{t(limit.scope==='pod'?'Pod 設定上限':'容器上限合計')}</Text>}
 </View>;
}
export function PodUsage({metrics,limits,compact=false}:{metrics?:PodMetrics;limits?:PodLimits;compact?:boolean}) {
 const styles=useThemedStyles(createStyles);const {t}=useLanguage();
 const names=metrics?.containers.map(item=>item.name) ?? [];
 const partial=!!metrics && !!limits && (limits.containers.some(item=>!names.includes(item.name)) || names.some(name=>!limits.containers.some(item=>item.name===name)));
 return <View style={compact?styles.columns:styles.stack}>
  <UsageMeter label="CPU" used={metrics?.cpuMilli} limit={limits?.cpu} unit="m" compact={compact} partial={partial}/>
  <UsageMeter label={t('記憶體')} used={metrics?.memoryMiB} limit={limits?.memory} unit="MiB" compact={compact} partial={partial}/>
 </View>;
}
const createStyles=(colors:ThemeColors)=>StyleSheet.create({
 meter:{flex:1,gap:5},line:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},label:{color:colors.text,fontSize:15,fontWeight:'600'},percent:{fontSize:18,fontWeight:'700'},value:{color:colors.text,fontSize:18,fontWeight:'600'},small:{color:colors.muted,fontSize:11},track:{height:6,borderRadius:4,overflow:'hidden',backgroundColor:colors.line},columns:{flexDirection:'row',gap:16,marginTop:4},stack:{gap:18},
});
