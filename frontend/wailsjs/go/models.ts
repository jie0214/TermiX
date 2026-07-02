export namespace app {
	
	export class DownloadResult {
	    success: boolean;
	    filePath: string;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new DownloadResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.filePath = source["filePath"];
	        this.error = source["error"];
	    }
	}
	export class UpdateInfo {
	    currentVersion: string;
	    latestVersion: string;
	    releaseUrl: string;
	    hasUpdate: boolean;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.currentVersion = source["currentVersion"];
	        this.latestVersion = source["latestVersion"];
	        this.releaseUrl = source["releaseUrl"];
	        this.hasUpdate = source["hasUpdate"];
	    }
	}

}

export namespace dto {
	
	export class AWSIntegration {
	    groupId: string;
	    name: string;
	    region: string;
	    accessKeyId: string;
	    secretAccessKeyRef: string;
	    defaultPasswordRef: string;
	    importSource: string;
	    ipAddressType: string;
	    defaultPort: number;
	    defaultUsername: string;
	    authMode: string;
	    privateKeyPath: string;
	    certPath: string;
	    lastSyncAt: string;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new AWSIntegration(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.groupId = source["groupId"];
	        this.name = source["name"];
	        this.region = source["region"];
	        this.accessKeyId = source["accessKeyId"];
	        this.secretAccessKeyRef = source["secretAccessKeyRef"];
	        this.defaultPasswordRef = source["defaultPasswordRef"];
	        this.importSource = source["importSource"];
	        this.ipAddressType = source["ipAddressType"];
	        this.defaultPort = source["defaultPort"];
	        this.defaultUsername = source["defaultUsername"];
	        this.authMode = source["authMode"];
	        this.privateKeyPath = source["privateKeyPath"];
	        this.certPath = source["certPath"];
	        this.lastSyncAt = source["lastSyncAt"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class SecretValueInput {
	    ref: string;
	    value: string;
	    hasValue: boolean;
	    clear: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SecretValueInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ref = source["ref"];
	        this.value = source["value"];
	        this.hasValue = source["hasValue"];
	        this.clear = source["clear"];
	    }
	}
	export class AWSIntegrationSecretsInput {
	    secretAccessKey: SecretValueInput;
	    defaultPassword: SecretValueInput;
	
	    static createFrom(source: any = {}) {
	        return new AWSIntegrationSecretsInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.secretAccessKey = this.convertValues(source["secretAccessKey"], SecretValueInput);
	        this.defaultPassword = this.convertValues(source["defaultPassword"], SecretValueInput);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AutocompleteResult {
	    success: boolean;
	    suggestions: string[];
	    lastWord: string;
	    isPath: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AutocompleteResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.suggestions = source["suggestions"];
	        this.lastWord = source["lastWord"];
	        this.isPath = source["isPath"];
	    }
	}
	export class SSHConfig {
	    host: string;
	    port: number;
	    username: string;
	    authMode: string;
	    password: string;
	    privateKeyPath: string;
	    certPath: string;
	    sudoPassword: string;
	    sessionId: string;
	    enableCustomQuery: boolean;
	    customQueryScript: string;
	
	    static createFrom(source: any = {}) {
	        return new SSHConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.authMode = source["authMode"];
	        this.password = source["password"];
	        this.privateKeyPath = source["privateKeyPath"];
	        this.certPath = source["certPath"];
	        this.sudoPassword = source["sudoPassword"];
	        this.sessionId = source["sessionId"];
	        this.enableCustomQuery = source["enableCustomQuery"];
	        this.customQueryScript = source["customQueryScript"];
	    }
	}
	export class SnippetExecutionTarget {
	    ssh: SSHConfig;
	
	    static createFrom(source: any = {}) {
	        return new SnippetExecutionTarget(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ssh = this.convertValues(source["ssh"], SSHConfig);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ExecuteSnippetBatchRequest {
	    snippetId: string;
	    targets: SnippetExecutionTarget[];
	
	    static createFrom(source: any = {}) {
	        return new ExecuteSnippetBatchRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.snippetId = source["snippetId"];
	        this.targets = this.convertValues(source["targets"], SnippetExecutionTarget);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HostConnectionRequest {
	    hostId: string;
	    sessionId: string;
	
	    static createFrom(source: any = {}) {
	        return new HostConnectionRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hostId = source["hostId"];
	        this.sessionId = source["sessionId"];
	    }
	}
	export class HostCustomComponent {
	    id: string;
	    visible: boolean;
	    order: number;
	
	    static createFrom(source: any = {}) {
	        return new HostCustomComponent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.visible = source["visible"];
	        this.order = source["order"];
	    }
	}
	export class HostExportOptions {
	    format: string;
	    mode: string;
	
	    static createFrom(source: any = {}) {
	        return new HostExportOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.format = source["format"];
	        this.mode = source["mode"];
	    }
	}
	export class HostGroup {
	    id: string;
	    name: string;
	    order: number;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new HostGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.order = source["order"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class HostImportOptions {
	    format: string;
	    mode: string;
	
	    static createFrom(source: any = {}) {
	        return new HostImportOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.format = source["format"];
	        this.mode = source["mode"];
	    }
	}
	export class HostSecretRefs {
	    sshPasswordRef: string;
	    keyPassphraseRef: string;
	    sudoPasswordRef: string;
	
	    static createFrom(source: any = {}) {
	        return new HostSecretRefs(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sshPasswordRef = source["sshPasswordRef"];
	        this.keyPassphraseRef = source["keyPassphraseRef"];
	        this.sudoPasswordRef = source["sudoPasswordRef"];
	    }
	}
	export class PersistedHostConfig {
	    host: string;
	    port: number;
	    username: string;
	    authMode: string;
	    privateKeyPath: string;
	    certPath: string;
	    secretRefs: HostSecretRefs;
	    showSnippetsInControlPanel: boolean;
	    startupSnippetIds: string[];
	    startupCommandMode: string;
	    startupCommandText: string;
	    customComponents: HostCustomComponent[];
	    enableCustomQuery: boolean;
	    customQueryScript: string;
	
	    static createFrom(source: any = {}) {
	        return new PersistedHostConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.authMode = source["authMode"];
	        this.privateKeyPath = source["privateKeyPath"];
	        this.certPath = source["certPath"];
	        this.secretRefs = this.convertValues(source["secretRefs"], HostSecretRefs);
	        this.showSnippetsInControlPanel = source["showSnippetsInControlPanel"];
	        this.startupSnippetIds = source["startupSnippetIds"];
	        this.startupCommandMode = source["startupCommandMode"];
	        this.startupCommandText = source["startupCommandText"];
	        this.customComponents = this.convertValues(source["customComponents"], HostCustomComponent);
	        this.enableCustomQuery = source["enableCustomQuery"];
	        this.customQueryScript = source["customQueryScript"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HostProfile {
	    id: string;
	    label: string;
	    alias: string;
	    groupId: string;
	    awsInstanceId: string;
	    config: PersistedHostConfig;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new HostProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.alias = source["alias"];
	        this.groupId = source["groupId"];
	        this.awsInstanceId = source["awsInstanceId"];
	        this.config = this.convertValues(source["config"], PersistedHostConfig);
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class HostSecretValueRequest {
	    hostId: string;
	    field: string;
	
	    static createFrom(source: any = {}) {
	        return new HostSecretValueRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hostId = source["hostId"];
	        this.field = source["field"];
	    }
	}
	export class HostSecretsInput {
	    sshPassword: SecretValueInput;
	    keyPassphrase: SecretValueInput;
	    sudoPassword: SecretValueInput;
	
	    static createFrom(source: any = {}) {
	        return new HostSecretsInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sshPassword = this.convertValues(source["sshPassword"], SecretValueInput);
	        this.keyPassphrase = this.convertValues(source["keyPassphrase"], SecretValueInput);
	        this.sudoPassword = this.convertValues(source["sudoPassword"], SecretValueInput);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HostStartupSnippet {
	    hostKey: string;
	    startupSnippetId: string;
	
	    static createFrom(source: any = {}) {
	        return new HostStartupSnippet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hostKey = source["hostKey"];
	        this.startupSnippetId = source["startupSnippetId"];
	    }
	}
	export class HostStartupSnippetRequest {
	    ssh: SSHConfig;
	    startupSnippetId: string;
	
	    static createFrom(source: any = {}) {
	        return new HostStartupSnippetRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ssh = this.convertValues(source["ssh"], SSHConfig);
	        this.startupSnippetId = source["startupSnippetId"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class KubernetesClusterProfile {
	    id: string;
	    displayName: string;
	    contextName: string;
	    clusterName: string;
	    server: string;
	    userName: string;
	    namespace: string;
	    certificateAuthority: string;
	    insecureSkipTLSVerify: boolean;
	    source: string;
	    isCurrent: boolean;
	    kubeconfigPath: string;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesClusterProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.displayName = source["displayName"];
	        this.contextName = source["contextName"];
	        this.clusterName = source["clusterName"];
	        this.server = source["server"];
	        this.userName = source["userName"];
	        this.namespace = source["namespace"];
	        this.certificateAuthority = source["certificateAuthority"];
	        this.insecureSkipTLSVerify = source["insecureSkipTLSVerify"];
	        this.source = source["source"];
	        this.isCurrent = source["isCurrent"];
	        this.kubeconfigPath = source["kubeconfigPath"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class KubernetesClusterRoleBindingSummary {
	    name: string;
	    roleRef: string;
	    subjects: number;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesClusterRoleBindingSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.roleRef = source["roleRef"];
	        this.subjects = source["subjects"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesClusterRoleSummary {
	    name: string;
	    rules: number;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesClusterRoleSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.rules = source["rules"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesConfigMapSummary {
	    name: string;
	    namespace: string;
	    dataKeys: number;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesConfigMapSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.dataKeys = source["dataKeys"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesConnectRequest {
	    clusterId: string;
	    displayName: string;
	    contextName: string;
	    clusterName: string;
	    server: string;
	    kubeconfigPath: string;
	    namespace: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesConnectRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.clusterId = source["clusterId"];
	        this.displayName = source["displayName"];
	        this.contextName = source["contextName"];
	        this.clusterName = source["clusterName"];
	        this.server = source["server"];
	        this.kubeconfigPath = source["kubeconfigPath"];
	        this.namespace = source["namespace"];
	    }
	}
	export class KubernetesContainerPort {
	    name: string;
	    port: number;
	    protocol: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesContainerPort(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.port = source["port"];
	        this.protocol = source["protocol"];
	    }
	}
	export class KubernetesContainerDetail {
	    name: string;
	    image: string;
	    ready: boolean;
	    restartCount: number;
	    state: string;
	    ports: KubernetesContainerPort[];
	
	    static createFrom(source: any = {}) {
	        return new KubernetesContainerDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.image = source["image"];
	        this.ready = source["ready"];
	        this.restartCount = source["restartCount"];
	        this.state = source["state"];
	        this.ports = this.convertValues(source["ports"], KubernetesContainerPort);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class KubernetesContextSwitchRequest {
	    contextName: string;
	    kubeconfigPath: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesContextSwitchRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.contextName = source["contextName"];
	        this.kubeconfigPath = source["kubeconfigPath"];
	    }
	}
	export class KubernetesCronJobSummary {
	    name: string;
	    namespace: string;
	    schedule: string;
	    suspend: boolean;
	    active: number;
	    lastSchedule: string;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesCronJobSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.schedule = source["schedule"];
	        this.suspend = source["suspend"];
	        this.active = source["active"];
	        this.lastSchedule = source["lastSchedule"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesCustomResourceDefinitionSummary {
	    name: string;
	    group: string;
	    kind: string;
	    scope: string;
	    versions: string;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesCustomResourceDefinitionSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.group = source["group"];
	        this.kind = source["kind"];
	        this.scope = source["scope"];
	        this.versions = source["versions"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesDashboardRequest {
	    namespace: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesDashboardRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.namespace = source["namespace"];
	    }
	}
	export class KubernetesEventSummary {
	    type: string;
	    reason: string;
	    message: string;
	    object: string;
	    namespace: string;
	    count: number;
	    timestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesEventSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.reason = source["reason"];
	        this.message = source["message"];
	        this.object = source["object"];
	        this.namespace = source["namespace"];
	        this.count = source["count"];
	        this.timestamp = source["timestamp"];
	    }
	}
	export class KubernetesResourceQuotaSummary {
	    name: string;
	    namespace: string;
	    hardLimits: number;
	    scopes: string;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesResourceQuotaSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.hardLimits = source["hardLimits"];
	        this.scopes = source["scopes"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesPodDisruptionBudgetSummary {
	    name: string;
	    namespace: string;
	    minAvailable: string;
	    maxUnavailable: string;
	    currentHealthy: number;
	    desiredHealthy: number;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesPodDisruptionBudgetSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.minAvailable = source["minAvailable"];
	        this.maxUnavailable = source["maxUnavailable"];
	        this.currentHealthy = source["currentHealthy"];
	        this.desiredHealthy = source["desiredHealthy"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesHorizontalPodAutoscalerSummary {
	    name: string;
	    namespace: string;
	    reference: string;
	    minReplicas: number;
	    maxReplicas: number;
	    currentReplicas: number;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesHorizontalPodAutoscalerSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.reference = source["reference"];
	        this.minReplicas = source["minReplicas"];
	        this.maxReplicas = source["maxReplicas"];
	        this.currentReplicas = source["currentReplicas"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesRoleBindingSummary {
	    name: string;
	    namespace: string;
	    roleRef: string;
	    subjects: number;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesRoleBindingSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.roleRef = source["roleRef"];
	        this.subjects = source["subjects"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesRoleSummary {
	    name: string;
	    namespace: string;
	    rules: number;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesRoleSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.rules = source["rules"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesServiceAccountSummary {
	    name: string;
	    namespace: string;
	    secrets: number;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesServiceAccountSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.secrets = source["secrets"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesNetworkPolicySummary {
	    name: string;
	    namespace: string;
	    policyTypes: string;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesNetworkPolicySummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.policyTypes = source["policyTypes"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesEndpointsSummary {
	    name: string;
	    namespace: string;
	    addresses: number;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesEndpointsSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.addresses = source["addresses"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesSecretSummary {
	    name: string;
	    namespace: string;
	    type: string;
	    dataKeys: number;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesSecretSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.type = source["type"];
	        this.dataKeys = source["dataKeys"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesStorageClassSummary {
	    name: string;
	    provisioner: string;
	    reclaimPolicy: string;
	    volumeBindingMode: string;
	    allowExpansion: boolean;
	    isDefault: boolean;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesStorageClassSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.provisioner = source["provisioner"];
	        this.reclaimPolicy = source["reclaimPolicy"];
	        this.volumeBindingMode = source["volumeBindingMode"];
	        this.allowExpansion = source["allowExpansion"];
	        this.isDefault = source["isDefault"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesPersistentVolumeSummary {
	    name: string;
	    status: string;
	    capacity: string;
	    storageClass: string;
	    accessModes: string;
	    reclaimPolicy: string;
	    claim: string;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesPersistentVolumeSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.status = source["status"];
	        this.capacity = source["capacity"];
	        this.storageClass = source["storageClass"];
	        this.accessModes = source["accessModes"];
	        this.reclaimPolicy = source["reclaimPolicy"];
	        this.claim = source["claim"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesPersistentVolumeClaimSummary {
	    name: string;
	    namespace: string;
	    status: string;
	    volumeName: string;
	    capacity: string;
	    storageClass: string;
	    accessModes: string;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesPersistentVolumeClaimSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.status = source["status"];
	        this.volumeName = source["volumeName"];
	        this.capacity = source["capacity"];
	        this.storageClass = source["storageClass"];
	        this.accessModes = source["accessModes"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesIngressSummary {
	    name: string;
	    namespace: string;
	    ingressClass: string;
	    hosts: string;
	    addresses: string;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesIngressSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.ingressClass = source["ingressClass"];
	        this.hosts = source["hosts"];
	        this.addresses = source["addresses"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesServiceSummary {
	    name: string;
	    namespace: string;
	    type: string;
	    clusterIp: string;
	    externalAddresses: string;
	    ports: string;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesServiceSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.type = source["type"];
	        this.clusterIp = source["clusterIp"];
	        this.externalAddresses = source["externalAddresses"];
	        this.ports = source["ports"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesJobSummary {
	    name: string;
	    namespace: string;
	    completions: string;
	    succeeded: number;
	    status: string;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesJobSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.completions = source["completions"];
	        this.succeeded = source["succeeded"];
	        this.status = source["status"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesWorkloadSummary {
	    name: string;
	    namespace: string;
	    desiredReplicas: number;
	    readyReplicas: number;
	    availableReplicas: number;
	    status: string;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesWorkloadSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.desiredReplicas = source["desiredReplicas"];
	        this.readyReplicas = source["readyReplicas"];
	        this.availableReplicas = source["availableReplicas"];
	        this.status = source["status"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesPodContainerSummary {
	    name: string;
	    ports: KubernetesContainerPort[];
	
	    static createFrom(source: any = {}) {
	        return new KubernetesPodContainerSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.ports = this.convertValues(source["ports"], KubernetesContainerPort);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class KubernetesPodSummary {
	    name: string;
	    namespace: string;
	    uid: string;
	    phase: string;
	    status: string;
	    ready: string;
	    restarts: number;
	    nodeName: string;
	    cpuUsageMilli: number;
	    memoryUsageBytes: number;
	    creationTimestamp: string;
	    containers: KubernetesPodContainerSummary[];
	
	    static createFrom(source: any = {}) {
	        return new KubernetesPodSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.uid = source["uid"];
	        this.phase = source["phase"];
	        this.status = source["status"];
	        this.ready = source["ready"];
	        this.restarts = source["restarts"];
	        this.nodeName = source["nodeName"];
	        this.cpuUsageMilli = source["cpuUsageMilli"];
	        this.memoryUsageBytes = source["memoryUsageBytes"];
	        this.creationTimestamp = source["creationTimestamp"];
	        this.containers = this.convertValues(source["containers"], KubernetesPodContainerSummary);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class KubernetesNodeSummary {
	    name: string;
	    status: string;
	    roles: string;
	    version: string;
	    cpuCapacityMilli: number;
	    memoryCapacityBytes: number;
	    cpuUsageMilli: number;
	    memoryUsageBytes: number;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesNodeSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.status = source["status"];
	        this.roles = source["roles"];
	        this.version = source["version"];
	        this.cpuCapacityMilli = source["cpuCapacityMilli"];
	        this.memoryCapacityBytes = source["memoryCapacityBytes"];
	        this.cpuUsageMilli = source["cpuUsageMilli"];
	        this.memoryUsageBytes = source["memoryUsageBytes"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesMetricsSummary {
	    available: boolean;
	    error: string;
	    cpuUsageMilli: number;
	    cpuCapacityMilli: number;
	    memoryUsageBytes: number;
	    memoryCapacityBytes: number;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesMetricsSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.error = source["error"];
	        this.cpuUsageMilli = source["cpuUsageMilli"];
	        this.cpuCapacityMilli = source["cpuCapacityMilli"];
	        this.memoryUsageBytes = source["memoryUsageBytes"];
	        this.memoryCapacityBytes = source["memoryCapacityBytes"];
	    }
	}
	export class KubernetesOverviewCounts {
	    nodes: number;
	    readyNodes: number;
	    pods: number;
	    runningPods: number;
	    pendingPods: number;
	    failedPods: number;
	    succeededPods: number;
	    deployments: number;
	    readyDeployments: number;
	    statefulSets: number;
	    readyStatefulSets: number;
	    services: number;
	    warningEvents: number;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesOverviewCounts(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nodes = source["nodes"];
	        this.readyNodes = source["readyNodes"];
	        this.pods = source["pods"];
	        this.runningPods = source["runningPods"];
	        this.pendingPods = source["pendingPods"];
	        this.failedPods = source["failedPods"];
	        this.succeededPods = source["succeededPods"];
	        this.deployments = source["deployments"];
	        this.readyDeployments = source["readyDeployments"];
	        this.statefulSets = source["statefulSets"];
	        this.readyStatefulSets = source["readyStatefulSets"];
	        this.services = source["services"];
	        this.warningEvents = source["warningEvents"];
	    }
	}
	export class KubernetesNamespaceSummary {
	    name: string;
	    status: string;
	    creationTimestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesNamespaceSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.status = source["status"];
	        this.creationTimestamp = source["creationTimestamp"];
	    }
	}
	export class KubernetesDashboardSnapshot {
	    sessionId: string;
	    clusterName: string;
	    contextName: string;
	    namespace: string;
	    serverVersion: string;
	    generatedAt: string;
	    namespaces: string[];
	    namespaceDetails: KubernetesNamespaceSummary[];
	    overview: KubernetesOverviewCounts;
	    metrics: KubernetesMetricsSummary;
	    nodes: KubernetesNodeSummary[];
	    pods: KubernetesPodSummary[];
	    deployments: KubernetesWorkloadSummary[];
	    statefulSets: KubernetesWorkloadSummary[];
	    daemonSets: KubernetesWorkloadSummary[];
	    jobs: KubernetesJobSummary[];
	    cronJobs: KubernetesCronJobSummary[];
	    services: KubernetesServiceSummary[];
	    ingresses: KubernetesIngressSummary[];
	    persistentVolumeClaims: KubernetesPersistentVolumeClaimSummary[];
	    persistentVolumes: KubernetesPersistentVolumeSummary[];
	    storageClasses: KubernetesStorageClassSummary[];
	    configMaps: KubernetesConfigMapSummary[];
	    secrets: KubernetesSecretSummary[];
	    endpoints: KubernetesEndpointsSummary[];
	    networkPolicies: KubernetesNetworkPolicySummary[];
	    serviceAccounts: KubernetesServiceAccountSummary[];
	    roles: KubernetesRoleSummary[];
	    roleBindings: KubernetesRoleBindingSummary[];
	    clusterRoles: KubernetesClusterRoleSummary[];
	    clusterRoleBindings: KubernetesClusterRoleBindingSummary[];
	    horizontalPodAutoscalers: KubernetesHorizontalPodAutoscalerSummary[];
	    podDisruptionBudgets: KubernetesPodDisruptionBudgetSummary[];
	    resourceQuotas: KubernetesResourceQuotaSummary[];
	    customResourceDefinitions: KubernetesCustomResourceDefinitionSummary[];
	    resourceErrors: Record<string, string>;
	    events: KubernetesEventSummary[];
	
	    static createFrom(source: any = {}) {
	        return new KubernetesDashboardSnapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.clusterName = source["clusterName"];
	        this.contextName = source["contextName"];
	        this.namespace = source["namespace"];
	        this.serverVersion = source["serverVersion"];
	        this.generatedAt = source["generatedAt"];
	        this.namespaces = source["namespaces"];
	        this.namespaceDetails = this.convertValues(source["namespaceDetails"], KubernetesNamespaceSummary);
	        this.overview = this.convertValues(source["overview"], KubernetesOverviewCounts);
	        this.metrics = this.convertValues(source["metrics"], KubernetesMetricsSummary);
	        this.nodes = this.convertValues(source["nodes"], KubernetesNodeSummary);
	        this.pods = this.convertValues(source["pods"], KubernetesPodSummary);
	        this.deployments = this.convertValues(source["deployments"], KubernetesWorkloadSummary);
	        this.statefulSets = this.convertValues(source["statefulSets"], KubernetesWorkloadSummary);
	        this.daemonSets = this.convertValues(source["daemonSets"], KubernetesWorkloadSummary);
	        this.jobs = this.convertValues(source["jobs"], KubernetesJobSummary);
	        this.cronJobs = this.convertValues(source["cronJobs"], KubernetesCronJobSummary);
	        this.services = this.convertValues(source["services"], KubernetesServiceSummary);
	        this.ingresses = this.convertValues(source["ingresses"], KubernetesIngressSummary);
	        this.persistentVolumeClaims = this.convertValues(source["persistentVolumeClaims"], KubernetesPersistentVolumeClaimSummary);
	        this.persistentVolumes = this.convertValues(source["persistentVolumes"], KubernetesPersistentVolumeSummary);
	        this.storageClasses = this.convertValues(source["storageClasses"], KubernetesStorageClassSummary);
	        this.configMaps = this.convertValues(source["configMaps"], KubernetesConfigMapSummary);
	        this.secrets = this.convertValues(source["secrets"], KubernetesSecretSummary);
	        this.endpoints = this.convertValues(source["endpoints"], KubernetesEndpointsSummary);
	        this.networkPolicies = this.convertValues(source["networkPolicies"], KubernetesNetworkPolicySummary);
	        this.serviceAccounts = this.convertValues(source["serviceAccounts"], KubernetesServiceAccountSummary);
	        this.roles = this.convertValues(source["roles"], KubernetesRoleSummary);
	        this.roleBindings = this.convertValues(source["roleBindings"], KubernetesRoleBindingSummary);
	        this.clusterRoles = this.convertValues(source["clusterRoles"], KubernetesClusterRoleSummary);
	        this.clusterRoleBindings = this.convertValues(source["clusterRoleBindings"], KubernetesClusterRoleBindingSummary);
	        this.horizontalPodAutoscalers = this.convertValues(source["horizontalPodAutoscalers"], KubernetesHorizontalPodAutoscalerSummary);
	        this.podDisruptionBudgets = this.convertValues(source["podDisruptionBudgets"], KubernetesPodDisruptionBudgetSummary);
	        this.resourceQuotas = this.convertValues(source["resourceQuotas"], KubernetesResourceQuotaSummary);
	        this.customResourceDefinitions = this.convertValues(source["customResourceDefinitions"], KubernetesCustomResourceDefinitionSummary);
	        this.resourceErrors = source["resourceErrors"];
	        this.events = this.convertValues(source["events"], KubernetesEventSummary);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	
	export class KubernetesKeyValue {
	    key: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesKeyValue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	    }
	}
	
	
	
	
	
	export class KubernetesOwnerReference {
	    apiVersion: string;
	    kind: string;
	    name: string;
	    uid: string;
	    controller: boolean;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesOwnerReference(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiVersion = source["apiVersion"];
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.uid = source["uid"];
	        this.controller = source["controller"];
	    }
	}
	
	
	
	export class KubernetesPodDeleteRequest {
	    namespace: string;
	    podName: string;
	    uid: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesPodDeleteRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.namespace = source["namespace"];
	        this.podName = source["podName"];
	        this.uid = source["uid"];
	    }
	}
	
	export class KubernetesPodLogs {
	    container: string;
	    content: string;
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesPodLogs(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.container = source["container"];
	        this.content = source["content"];
	        this.truncated = source["truncated"];
	    }
	}
	export class KubernetesPodLogsRequest {
	    namespace: string;
	    podName: string;
	    container: string;
	    previous: boolean;
	    tailLines: number;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesPodLogsRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.namespace = source["namespace"];
	        this.podName = source["podName"];
	        this.container = source["container"];
	        this.previous = source["previous"];
	        this.tailLines = source["tailLines"];
	    }
	}
	export class KubernetesPodPortForward {
	    id: string;
	    namespace: string;
	    podName: string;
	    address: string;
	    localPort: number;
	    remotePort: number;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesPodPortForward(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.namespace = source["namespace"];
	        this.podName = source["podName"];
	        this.address = source["address"];
	        this.localPort = source["localPort"];
	        this.remotePort = source["remotePort"];
	    }
	}
	export class KubernetesPodPortForwardListRequest {
	    namespace: string;
	    podName: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesPodPortForwardListRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.namespace = source["namespace"];
	        this.podName = source["podName"];
	    }
	}
	export class KubernetesPodPortForwardRequest {
	    namespace: string;
	    podName: string;
	    localPort: number;
	    remotePort: number;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesPodPortForwardRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.namespace = source["namespace"];
	        this.podName = source["podName"];
	        this.localPort = source["localPort"];
	        this.remotePort = source["remotePort"];
	    }
	}
	export class KubernetesPodPortForwardStopRequest {
	    id: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesPodPortForwardStopRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	    }
	}
	export class KubernetesPodShellSession {
	    sessionId: string;
	    namespace: string;
	    podName: string;
	    container: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesPodShellSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.namespace = source["namespace"];
	        this.podName = source["podName"];
	        this.container = source["container"];
	    }
	}
	export class KubernetesPodShellSessionRequest {
	    sessionId: string;
	    data: string;
	    cols: number;
	    rows: number;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesPodShellSessionRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.data = source["data"];
	        this.cols = source["cols"];
	        this.rows = source["rows"];
	    }
	}
	export class KubernetesPodShellStartRequest {
	    namespace: string;
	    podName: string;
	    container: string;
	    cols: number;
	    rows: number;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesPodShellStartRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.namespace = source["namespace"];
	        this.podName = source["podName"];
	        this.container = source["container"];
	        this.cols = source["cols"];
	        this.rows = source["rows"];
	    }
	}
	
	export class KubernetesResourceCondition {
	    type: string;
	    status: string;
	    reason: string;
	    message: string;
	    lastTransitionTime: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesResourceCondition(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.status = source["status"];
	        this.reason = source["reason"];
	        this.message = source["message"];
	        this.lastTransitionTime = source["lastTransitionTime"];
	    }
	}
	export class KubernetesResourceCreateRequest {
	    resourceType: string;
	    namespace: string;
	    yaml: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesResourceCreateRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.resourceType = source["resourceType"];
	        this.namespace = source["namespace"];
	        this.yaml = source["yaml"];
	    }
	}
	export class KubernetesResourceCreateResult {
	    apiVersion: string;
	    kind: string;
	    name: string;
	    namespace: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesResourceCreateResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiVersion = source["apiVersion"];
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	    }
	}
	export class KubernetesResourceDeleteRequest {
	    kind: string;
	    name: string;
	    namespace: string;
	    uid: string;
	    apiVersion: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesResourceDeleteRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.uid = source["uid"];
	        this.apiVersion = source["apiVersion"];
	    }
	}
	export class KubernetesResourceDetail {
	    kind: string;
	    name: string;
	    namespace: string;
	    status: string;
	    createdAt: string;
	    uid: string;
	    apiVersion: string;
	    yaml: string;
	    labels: KubernetesKeyValue[];
	    owners: KubernetesOwnerReference[];
	    fields: KubernetesKeyValue[];
	    conditions: KubernetesResourceCondition[];
	    containers: KubernetesContainerDetail[];
	    events: KubernetesEventSummary[];
	    eventsError: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesResourceDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.status = source["status"];
	        this.createdAt = source["createdAt"];
	        this.uid = source["uid"];
	        this.apiVersion = source["apiVersion"];
	        this.yaml = source["yaml"];
	        this.labels = this.convertValues(source["labels"], KubernetesKeyValue);
	        this.owners = this.convertValues(source["owners"], KubernetesOwnerReference);
	        this.fields = this.convertValues(source["fields"], KubernetesKeyValue);
	        this.conditions = this.convertValues(source["conditions"], KubernetesResourceCondition);
	        this.containers = this.convertValues(source["containers"], KubernetesContainerDetail);
	        this.events = this.convertValues(source["events"], KubernetesEventSummary);
	        this.eventsError = source["eventsError"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class KubernetesResourceDetailRequest {
	    kind: string;
	    name: string;
	    namespace: string;
	    apiVersion: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesResourceDetailRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.apiVersion = source["apiVersion"];
	    }
	}
	
	export class KubernetesResourceUpdateRequest {
	    namespace: string;
	    yaml: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesResourceUpdateRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.namespace = source["namespace"];
	        this.yaml = source["yaml"];
	    }
	}
	
	
	
	
	
	export class KubernetesSession {
	    sessionId: string;
	    clusterId: string;
	    displayName: string;
	    contextName: string;
	    clusterName: string;
	    server: string;
	    kubeconfigPath: string;
	    namespace: string;
	    connectedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new KubernetesSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.clusterId = source["clusterId"];
	        this.displayName = source["displayName"];
	        this.contextName = source["contextName"];
	        this.clusterName = source["clusterName"];
	        this.server = source["server"];
	        this.kubeconfigPath = source["kubeconfigPath"];
	        this.namespace = source["namespace"];
	        this.connectedAt = source["connectedAt"];
	    }
	}
	
	
	export class OperationResult {
	    success: boolean;
	    output: string;
	    error: string;
	    sessionKey: string;
	    isSudo: boolean;
	
	    static createFrom(source: any = {}) {
	        return new OperationResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.output = source["output"];
	        this.error = source["error"];
	        this.sessionKey = source["sessionKey"];
	        this.isSudo = source["isSudo"];
	    }
	}
	
	
	
	export class Snippet {
	    id: string;
	    name: string;
	    description: string;
	    script: string;
	    package: string;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Snippet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.script = source["script"];
	        this.package = source["package"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class SnippetExecutionItemResult {
	    hostKey: string;
	    success: boolean;
	    output: string;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new SnippetExecutionItemResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hostKey = source["hostKey"];
	        this.success = source["success"];
	        this.output = source["output"];
	        this.error = source["error"];
	    }
	}
	export class SnippetBatchResult {
	    success: boolean;
	    results: SnippetExecutionItemResult[];
	
	    static createFrom(source: any = {}) {
	        return new SnippetBatchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.results = this.convertValues(source["results"], SnippetExecutionItemResult);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class SnippetUpsertRequest {
	    id: string;
	    name: string;
	    description: string;
	    script: string;
	    package: string;
	
	    static createFrom(source: any = {}) {
	        return new SnippetUpsertRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.script = source["script"];
	        this.package = source["package"];
	    }
	}
	export class TerminalCommandRequest {
	    ssh: SSHConfig;
	    command: string;
	
	    static createFrom(source: any = {}) {
	        return new TerminalCommandRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ssh = this.convertValues(source["ssh"], SSHConfig);
	        this.command = source["command"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

