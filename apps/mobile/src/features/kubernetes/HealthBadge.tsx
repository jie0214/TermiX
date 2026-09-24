import { Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../components/theme';
import { useLanguage } from '../language/LanguageProvider';
import type { Health } from './workspace';
const labels: Record<Health,string> = {healthy:'健康',unhealthy:'不健康',pending:'啟動／更新中',completed:'已完成',stopped:'已停止',terminating:'終止中',unknown:'狀態未知'};
export function HealthBadge({health='unknown'}:{health?:Health}) {
 const {colors,dark}=useTheme();const {t}=useLanguage();
 const color=health==='healthy'?(dark?'#66d99a':'#176b3b'):health==='unhealthy'?colors.danger:health==='pending'?(dark?'#f2bf66':'#805600'):colors.muted;
 const icon=health==='healthy'?'check-circle':health==='unhealthy'?'alert-circle':'minus-circle';
 return <View style={{flexDirection:'row',alignItems:'center',gap:6,alignSelf:'flex-start'}}><Feather name={icon} size={15} color={color}/><Text style={{color,fontSize:13,fontWeight:'600'}}>{t(labels[health] ?? labels.unknown)}</Text></View>;
}
