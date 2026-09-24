import {render,screen} from '@testing-library/react-native';
import {PodUsage,UsageMeter} from '../src/features/kubernetes/ResourceUsage';
test('用量顯示已用與上限、百分比，超過上限仍顯示實際比例',async()=>{
 const view=await render(<UsageMeter label="CPU" used={250} limit={{state:'set',value:1000}} unit="m"/>);
 expect(screen.getByText('250 / 1000 m')).toBeTruthy();expect(screen.getByText('25%')).toBeTruthy();expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(25);
 await view.rerender(<UsageMeter label="CPU" used={1200} limit={{state:'set',value:1000}} unit="m"/>);
 expect(screen.getByText('120%')).toBeTruthy();expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(100);
 await view.rerender(<UsageMeter label="CPU" used={24} limit={{state:'unset'}} unit="m"/>);
 expect(screen.getByText('24 m / 未設定上限')).toBeTruthy();expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBeUndefined();
 await view.rerender(<UsageMeter label="CPU" limit={{state:'set',value:1000}} unit="m"/>);
 expect(screen.getByText('— / 1000 m')).toBeTruthy();expect(screen.queryByText('0%')).toBeNull();
});
test('缺少容器採樣不可顯示低估的整體百分比',async()=>{
 await render(<PodUsage limits={{cpu:{state:'set',value:1000},memory:{state:'set',value:128},containers:[{name:'app',cpu:{state:'set',value:500},memory:{state:'set',value:64}},{name:'sidecar',cpu:{state:'set',value:500},memory:{state:'set',value:64}}]}}
 metrics={{cpuMilli:250,memoryMiB:32,timestamp:'2026-09-25T00:00:00Z',windowSeconds:30,containers:[{name:'app',cpuMilli:250,memoryMiB:32}]}}/>);
 expect(screen.getAllByText('部分用量')).toHaveLength(2);expect(screen.queryByText('25%')).toBeNull();
});
