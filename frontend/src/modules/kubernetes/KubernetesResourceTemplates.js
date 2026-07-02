// 單一 registry：新增一種可建立資源只需在此加一個 { group, type, template } 物件；
// 下方的下拉分組、型別清單、範本查找皆由此衍生，無需再改多處。
// template 函式接收目標 namespace，回傳最簡範例 YAML（沿用下方 helper）。
// 註：template 引用的函式為函式宣告（hoisted），故可在此提前引用。
const KUBERNETES_CREATE_RESOURCES = Object.freeze([
  { group: 'Workloads', type: 'Pod', template: podTemplate },
  { group: 'Workloads', type: 'Deployment', template: (ns) => workloadTemplate('apps/v1', 'Deployment', 'termix-deployment', ns) },
  { group: 'Workloads', type: 'ReplicaSet', template: (ns) => workloadTemplate('apps/v1', 'ReplicaSet', 'termix-replicaset', ns) },
  { group: 'Workloads', type: 'ReplicationController', template: replicationControllerTemplate },
  { group: 'Workloads', type: 'DaemonSet', template: (ns) => workloadTemplate('apps/v1', 'DaemonSet', 'termix-daemonset', ns, { replicas: false }) },
  { group: 'Workloads', type: 'StatefulSet', template: (ns) => workloadTemplate('apps/v1', 'StatefulSet', 'termix-statefulset', ns, { serviceName: 'termix-statefulset' }) },
  { group: 'Workloads', type: 'Job', template: jobTemplate },
  { group: 'Workloads', type: 'CronJob', template: cronJobTemplate },
  { group: 'Config', type: 'ConfigMap', template: configMapTemplate },
  { group: 'Config', type: 'Secret', template: secretTemplate },
  { group: 'Networking', type: 'Service', template: serviceTemplate },
  { group: 'Networking', type: 'Ingress', template: ingressTemplate },
  { group: 'Networking', type: 'NetworkPolicy', template: networkPolicyTemplate },
  { group: 'Storage', type: 'PersistentVolumeClaim', template: persistentVolumeClaimTemplate },
  { group: 'Access Control', type: 'ServiceAccount', template: serviceAccountTemplate },
  { group: 'Access Control', type: 'Role', template: roleTemplate },
  { group: 'Access Control', type: 'RoleBinding', template: roleBindingTemplate },
  { group: 'Autoscaling & Policy', type: 'HorizontalPodAutoscaler', template: horizontalPodAutoscalerTemplate },
  { group: 'Autoscaling & Policy', type: 'PodDisruptionBudget', template: podDisruptionBudgetTemplate },
  { group: 'Autoscaling & Policy', type: 'ResourceQuota', template: resourceQuotaTemplate }
]);

// 下拉分組（保序）：由 registry 依 group 聚合而成。
export const KUBERNETES_CREATE_RESOURCE_GROUPS = Object.freeze(
  KUBERNETES_CREATE_RESOURCES.reduce((groups, { group, type }) => {
    const existing = groups.find(([name]) => name === group);
    if (existing) existing[1].push(type);
    else groups.push([group, [type]]);
    return groups;
  }, [])
);

export const KUBERNETES_CREATE_RESOURCE_TYPES = Object.freeze(
  KUBERNETES_CREATE_RESOURCES.map(({ type }) => type)
);

const TEMPLATE_BY_TYPE = new Map(
  KUBERNETES_CREATE_RESOURCES.map(({ type, template }) => [type, template])
);

function yamlString(value) {
  return JSON.stringify(String(value || 'default'));
}

// 硬化的預設 Pod spec：pod 層停用 SA token 自動掛載、runAsNonRoot + RuntimeDefault seccomp；
// container 層停用權限提升並 drop 所有 capabilities。因採非 root 的 nginx-unprivileged 映像
// （無法綁 80），containerPort 用 8080。映像固定版本、不用 :latest，避免不可預期的更新。
function podSpec(indent = 'spec:') {
  return `${indent}
  automountServiceAccountToken: false
  securityContext:
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: nginx
      image: nginxinc/nginx-unprivileged:1.27-alpine
      ports:
        - name: http
          containerPort: 8080
      resources:
        requests:
          cpu: 50m
          memory: 64Mi
        limits:
          cpu: 200m
          memory: 128Mi
      readinessProbe:
        httpGet:
          path: /
          port: http
        initialDelaySeconds: 3
        periodSeconds: 10
      livenessProbe:
        httpGet:
          path: /
          port: http
        initialDelaySeconds: 10
        periodSeconds: 20
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]`;
}

function workloadTemplate(apiVersion, kind, name, namespace, options = {}) {
  const replicas = options.replicas === false ? '' : '  replicas: 1\n';
  const serviceName = options.serviceName ? `  serviceName: ${options.serviceName}\n` : '';
  return `apiVersion: ${apiVersion}
kind: ${kind}
metadata:
  name: ${name}
  namespace: ${yamlString(namespace)}
  labels:
    app: ${name}
spec:
${replicas}${serviceName}  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
    ${podSpec('spec:').replaceAll('\n', '\n    ')}`;
}

function replicationControllerTemplate(namespace) {
  return `apiVersion: v1
kind: ReplicationController
metadata:
  name: termix-rc
  namespace: ${yamlString(namespace)}
  labels:
    app: termix-rc
spec:
  replicas: 1
  selector:
    app: termix-rc
  template:
    metadata:
      labels:
        app: termix-rc
    ${podSpec('spec:').replaceAll('\n', '\n    ')}`;
}

function podTemplate(namespace) {
  return `apiVersion: v1
kind: Pod
metadata:
  name: termix-pod
  namespace: ${yamlString(namespace)}
  labels:
    app: termix
${podSpec()}`;
}

function jobTemplate(namespace) {
  return `apiVersion: batch/v1
kind: Job
metadata:
  name: my-job
  namespace: ${yamlString(namespace)}
  labels:
    app: termix
spec:
  backoffLimit: 3
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels:
        app: my-job
    spec:
      restartPolicy: Never
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        runAsGroup: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: main
          image: busybox:1.36
          command: ["echo", "Hello from TermiX"]
          resources:
            requests:
              cpu: 10m
              memory: 16Mi
            limits:
              cpu: 50m
              memory: 32Mi
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]`;
}

function cronJobTemplate(namespace) {
  return `apiVersion: batch/v1
kind: CronJob
metadata:
  name: my-cronjob
  namespace: ${yamlString(namespace)}
  labels:
    app: termix
spec:
  schedule: "*/5 * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        metadata:
          labels:
            app: my-cronjob
        spec:
          restartPolicy: OnFailure
          automountServiceAccountToken: false
          securityContext:
            runAsNonRoot: true
            runAsUser: 65534
            runAsGroup: 65534
            seccompProfile:
              type: RuntimeDefault
          containers:
            - name: main
              image: busybox:1.36
              command: ["echo", "Hello from TermiX"]
              resources:
                requests:
                  cpu: 10m
                  memory: 16Mi
                limits:
                  cpu: 50m
                  memory: 32Mi
              securityContext:
                allowPrivilegeEscalation: false
                capabilities:
                  drop: ["ALL"]`;
}

function serviceTemplate(namespace) {
  return `apiVersion: v1
kind: Service
metadata:
  name: termix-service
  namespace: ${yamlString(namespace)}
  labels:
    app: my-app
spec:
  type: ClusterIP
  selector:
    app: termix
  ports:
    - name: http
      port: 80
      targetPort: 8080
      protocol: TCP`;
}

function configMapTemplate(namespace) {
  return `apiVersion: v1
kind: ConfigMap
metadata:
  name: termix-config
  namespace: ${yamlString(namespace)}
data:
  key: value`;
}

function secretTemplate(namespace) {
  return `apiVersion: v1
kind: Secret
metadata:
  name: termix-secret
  namespace: ${yamlString(namespace)}
type: Opaque
stringData:
  key: value`;
}

function serviceAccountTemplate(namespace) {
  return `apiVersion: v1
kind: ServiceAccount
metadata:
  name: termix-serviceaccount
  namespace: ${yamlString(namespace)}`;
}

function ingressTemplate(namespace) {
  return `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: termix-ingress
  namespace: ${yamlString(namespace)}
spec:
  rules:
    - host: termix.example.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: termix-service
                port:
                  number: 80`;
}

function networkPolicyTemplate(namespace) {
  return `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: termix-networkpolicy
  namespace: ${yamlString(namespace)}
spec:
  podSelector: {}
  policyTypes:
    - Ingress`;
}

function persistentVolumeClaimTemplate(namespace) {
  return `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: termix-pvc
  namespace: ${yamlString(namespace)}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi`;
}

function roleTemplate(namespace) {
  return `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: termix-role
  namespace: ${yamlString(namespace)}
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]`;
}

function roleBindingTemplate(namespace) {
  return `apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: termix-rolebinding
  namespace: ${yamlString(namespace)}
subjects:
  - kind: ServiceAccount
    name: termix-serviceaccount
    namespace: ${yamlString(namespace)}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: termix-role`;
}

function horizontalPodAutoscalerTemplate(namespace) {
  return `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: termix-hpa
  namespace: ${yamlString(namespace)}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: termix-deployment
  minReplicas: 1
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 80`;
}

function podDisruptionBudgetTemplate(namespace) {
  return `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: termix-pdb
  namespace: ${yamlString(namespace)}
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: termix`;
}

function resourceQuotaTemplate(namespace) {
  return `apiVersion: v1
kind: ResourceQuota
metadata:
  name: termix-quota
  namespace: ${yamlString(namespace)}
spec:
  hard:
    pods: "10"
    requests.cpu: "1"
    requests.memory: 1Gi
    limits.cpu: "2"
    limits.memory: 2Gi`;
}

export function createResourceTemplate(resourceType, namespace = 'default') {
  const template = TEMPLATE_BY_TYPE.get(resourceType) || podTemplate;
  return template(namespace);
}
