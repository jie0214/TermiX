package expo.modules.termixssh

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.functions.Coroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import expo.modules.kotlin.modules.ModuleDefinition
import com.termix.mobilessh.Mobilessh

class TermixSSHModule : Module() {
  private val engine = Mobilessh.newEngine()
  override fun definition() = ModuleDefinition {
    Name("TermixSSH")
    AsyncFunction("start") { config: String -> engine.start(config) }
    AsyncFunction("poll") { id: String -> engine.poll(id) }
    AsyncFunction("trust") { id: String, accept: Boolean -> engine.trust(id, accept) }
    AsyncFunction("write") Coroutine { id: String, data: String -> withContext(Dispatchers.IO) { engine.write(id, data) } }
    AsyncFunction("resize") Coroutine { id: String, cols: Int, rows: Int -> withContext(Dispatchers.IO) { engine.resize(id, cols.toLong(), rows.toLong()) } }
    AsyncFunction("disconnect") { id: String -> engine.disconnect(id) }
    AsyncFunction("awsProfileKey") Coroutine { region: String, profile: String -> withContext(Dispatchers.IO) { Mobilessh.awsProfileKey(region, profile) } }
    AsyncFunction("loginAWS") Coroutine { region: String, credentials: String -> withContext(Dispatchers.IO) { Mobilessh.loginAWS(region, credentials) } }
    AsyncFunction("authorizeEKS") Coroutine { raw: String, credentials: String -> withContext(Dispatchers.IO) { Mobilessh.authorizeEKS(raw, credentials) } }
    AsyncFunction("selectKubeAWSProfile") Coroutine { raw: String, value: String -> withContext(Dispatchers.IO) { Mobilessh.selectKubeAWSProfile(raw, value) } }
    AsyncFunction("listKubeNamespaces") Coroutine { raw: String, value: String -> withContext(Dispatchers.IO) { Mobilessh.listKubeNamespaces(raw, value) } }
    AsyncFunction("inspectKubeContexts") Coroutine { raw: String -> withContext(Dispatchers.IO) { Mobilessh.inspectKubeContexts(raw) } }
    AsyncFunction("selectKubeContext") Coroutine { raw: String, name: String -> withContext(Dispatchers.IO) { Mobilessh.selectKubeContext(raw, name) } }
    AsyncFunction("inspectKubeconfig") Coroutine { raw: String -> withContext(Dispatchers.IO) { Mobilessh.inspectKubeconfig(raw) } }
    AsyncFunction("listKubePods") Coroutine { raw: String, namespace: String -> withContext(Dispatchers.IO) { Mobilessh.listKubePods(raw, namespace) } }
    AsyncFunction("listKubeResources") Coroutine { raw: String, namespace: String, kind: String -> withContext(Dispatchers.IO) { Mobilessh.listKubeResources(raw, namespace, kind) } }
    AsyncFunction("getKubeConfigMap") Coroutine { raw: String, namespace: String, name: String -> withContext(Dispatchers.IO) { Mobilessh.getKubeConfigMap(raw, namespace, name) } }
    AsyncFunction("listKubePodMetrics") Coroutine { raw: String, namespace: String -> withContext(Dispatchers.IO) { Mobilessh.listKubePodMetrics(raw, namespace) } }
    AsyncFunction("getKubePodMetrics") Coroutine { raw: String, namespace: String, name: String -> withContext(Dispatchers.IO) { Mobilessh.getKubePodMetrics(raw, namespace, name) } }
    AsyncFunction("getKubeScale") Coroutine { raw: String, namespace: String, kind: String, name: String -> withContext(Dispatchers.IO) { Mobilessh.getKubeScale(raw, namespace, kind, name) } }
    AsyncFunction("updateKubeScale") Coroutine { raw: String, namespace: String, kind: String, name: String, payload: String -> withContext(Dispatchers.IO) { Mobilessh.updateKubeScale(raw, namespace, kind, name, payload) } }
    AsyncFunction("getKubePodContainers") Coroutine { raw: String, namespace: String, name: String -> withContext(Dispatchers.IO) { Mobilessh.getKubePodContainers(raw, namespace, name) } }
    AsyncFunction("getKubePodLogs") Coroutine { raw: String, namespace: String, name: String, container: String, previous: Boolean -> withContext(Dispatchers.IO) { Mobilessh.getKubePodLogs(raw, namespace, name, container, previous) } }
    OnActivityEntersBackground { engine.close() }
    OnDestroy { engine.close() }
  }
}
