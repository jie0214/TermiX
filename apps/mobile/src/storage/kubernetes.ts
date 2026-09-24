import { awsRepository } from './aws';
import { requireNativeModule } from 'expo';
import { KubernetesWorkspace, type KubeClient, type PodMetrics, type ScaleValue, type PodContainers, type PodLog, type KubeProfile, type ResourceList, type ConfigMapDetail, type PodList } from '../features/kubernetes/workspace';
import { kubeconfigStorage } from './kubeconfig';

type NativeKubernetes = { listKubePodMetrics(raw:string,namespace:string):Promise<string>; awsProfileKey(region:string,name:string):Promise<string>; selectKubeAWSProfile(raw:string,name:string):Promise<string>; listKubeNamespaces(raw:string,cursor:string):Promise<string>; inspectKubeContexts(raw: string): Promise<string>; selectKubeContext(raw: string, name: string): Promise<string>; getKubePodMetrics(raw: string, namespace: string, name: string): Promise<string>; getKubeScale(raw: string, namespace: string, kind: string, name: string): Promise<string>; updateKubeScale(raw: string, namespace: string, kind: string, name: string, payload: string): Promise<string>; getKubePodContainers(raw: string, namespace: string, name: string): Promise<string>; getKubePodLogs(raw: string, namespace: string, name: string, container: string, previous: boolean): Promise<string>; inspectKubeconfig(raw: string): Promise<string>; listKubePods(raw: string, namespace: string): Promise<string>; listKubeResources(raw: string, namespace: string, kind: string): Promise<string>; getKubeConfigMap(raw: string, namespace: string, name: string): Promise<string> };
const native = requireNativeModule<NativeKubernetes>('TermixSSH');
async function authorize(raw: string): Promise<string> {
  const profile = JSON.parse(await native.inspectKubeContexts(raw)) as KubeProfile;
  if (profile.issue) throw new Error(profile.issue);
  raw = await native.selectKubeContext(raw, profile.context);
  return profile.eks ? awsRepository.authorize(raw, profile.eks) : raw;
}
const client: KubeClient = {
 async listPodMetrics(raw,namespace) { return JSON.parse(await native.listKubePodMetrics(await authorize(raw),namespace)); },
  async listAWSProfiles(region) {
    const profiles = await awsRepository.list();
    const compatible = await Promise.all(profiles.map(async profile => (await native.awsProfileKey(region, profile.name)) === profile.key ? profile : null));
    return compatible.filter(profile => profile !== null);
  },
  selectAWSProfile: (raw,name) => native.selectKubeAWSProfile(raw,name),
  async listNamespaces(raw,cursor) { return JSON.parse(await native.listKubeNamespaces(await authorize(raw),cursor)); },
  selectContext: (raw, name) => native.selectKubeContext(raw, name),
  async getPodMetrics(raw, namespace, name) { return JSON.parse(await native.getKubePodMetrics(await authorize(raw), namespace, name)) as PodMetrics; },
  async getScale(raw, namespace, kind, name) { return JSON.parse(await native.getKubeScale(await authorize(raw), namespace, kind, name)) as ScaleValue; },
  async updateScale(raw, namespace, kind, name, value) { return JSON.parse(await native.updateKubeScale(await authorize(raw), namespace, kind, name, JSON.stringify(value))) as ScaleValue; },
  async getPodContainers(raw, namespace, name) { return JSON.parse(await native.getKubePodContainers(await authorize(raw), namespace, name)) as PodContainers; },
  async getPodLogs(raw, namespace, name, container, previous) { return JSON.parse(await native.getKubePodLogs(await authorize(raw), namespace, name, container, previous)) as PodLog; },
  async inspect(raw) { return JSON.parse(await native.inspectKubeContexts(raw)) as KubeProfile; },
  async listResources(raw, namespace, kind) { return JSON.parse(await native.listKubeResources(await authorize(raw), namespace, kind)) as ResourceList; },
  async getConfigMap(raw, namespace, name) { return JSON.parse(await native.getKubeConfigMap(await authorize(raw), namespace, name)) as ConfigMapDetail; },
  async listPods(raw, namespace) { return JSON.parse(await native.listKubePods(await authorize(raw), namespace)) as PodList; },
};
export const kubernetesWorkspace = new KubernetesWorkspace(client, kubeconfigStorage);
