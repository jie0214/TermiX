import { render,screen,fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import Settings from '../src/app/(tabs)/settings';
import CloudProvider from '../src/app/settings/cloud-provider';
import CloudAccounts from '../src/app/settings/cloud-accounts';
jest.mock('expo-router',()=>({router:{push:jest.fn(),back:jest.fn()}}));
test('設定以雲端帳號為入口，Kubernetes 連線獨立管理',async()=>{
 const view=await render(<Settings/>);
 expect(screen.queryByRole('button',{name:'AWS profiles'})).toBeNull();
 await fireEvent.press(screen.getByRole('button',{name:'Kubernetes'}));expect(router.push).toHaveBeenCalledWith('/settings/kubernetes');
 await fireEvent.press(screen.getByRole('button',{name:'雲端帳號'}));expect(router.push).toHaveBeenCalledWith('/settings/cloud-accounts');
 await view.rerender(<CloudAccounts/>);await fireEvent.press(screen.getByRole('button',{name:'AWS · 帳號與憑證'}));expect(router.push).toHaveBeenCalledWith('/settings/aws');
 expect(screen.queryByText('GCP')).toBeNull();expect(screen.queryByText('Azure')).toBeNull();
});


test('新增雲端帳號先選供應商，目前僅提供 AWS 並可返回',async()=>{
 const view=await render(<CloudAccounts/>);
 await fireEvent.press(screen.getByRole('button',{name:'新增雲端帳號'}));expect(router.push).toHaveBeenCalledWith('/settings/cloud-provider');
 await view.rerender(<CloudProvider/>);
 expect(screen.getByText('選擇雲端供應商')).toBeTruthy();
 expect(screen.queryByText('GCP')).toBeNull();expect(screen.queryByText('Azure')).toBeNull();
 await fireEvent.press(screen.getByRole('button',{name:'AWS'}));expect(router.push).toHaveBeenCalledWith('/settings/aws');
 await fireEvent.press(screen.getByRole('button',{name:'返回'}));expect(router.back).toHaveBeenCalled();
});
