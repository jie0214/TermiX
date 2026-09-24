import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AwsRepository, type AwsNative } from '../src/features/aws/repository';
import { AwsSettings } from '../src/features/aws/AwsSettings';
import { memoryVault } from './fixtures';

test('手機新增 AWS profile 後可停用、啟用及確認刪除，秘密欄位保存後清空',async()=>{
 const native:AwsNative={awsProfileKey:async()=>`termix.aws.${'a'.repeat(64)}`,loginAWS:async()=>JSON.stringify({account:'123456789012',arn:'test'}),authorizeEKS:async()=>''};
 const repository=new AwsRepository(memoryVault(),native);
 await render(<AwsSettings repository={repository} suggested={{name:'work',region:'ap-northeast-1'}}/>);
 await waitFor(()=>expect(screen.queryByRole('button',{name:'重試'})).toBeNull());
 expect(screen.getByLabelText('AWS profile').props.value).toBe('work');
 for(const [label,value] of [['Access Key ID','AKIATESTONLY12345678'],['Secret Access Key','test-only-secret']]) {
  expect(screen.getByLabelText(label).props.secureTextEntry).toBe(true);
  await fireEvent.changeText(screen.getByLabelText(label),value);
 }
 await fireEvent.press(screen.getByRole('button',{name:'驗證並儲存'}));
 await screen.findByText('AWS profile 已驗證並安全保存。');
 expect(screen.getByLabelText('Secret Access Key').props.value).toBe('');
 await fireEvent.press(screen.getByRole('button',{name:'停用'}));
 await screen.findByRole('button',{name:'啟用'});
 expect((await repository.list())[0].enabled).toBe(false);
 await fireEvent.press(screen.getByRole('button',{name:'啟用'}));
 await screen.findByRole('button',{name:'停用'});
 const alert=jest.spyOn(Alert,'alert').mockImplementation(()=>{});
 await fireEvent.press(screen.getByRole('button',{name:'刪除'}));
 expect((await repository.list()).length).toBe(1);
 const confirm=alert.mock.calls[0][2]?.find(item=>item.style==='destructive');
 await act(() => { confirm?.onPress?.(); });
 await waitFor(()=>expect(screen.queryByRole('button',{name:'停用'})).toBeNull());
 expect(await repository.list()).toEqual([]);alert.mockRestore();
});
