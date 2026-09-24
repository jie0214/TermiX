import ExpoModulesCore
import TermixSSH

public class TermixSSHModule: Module {
  private let engine = MobilesshNewEngine()!

  public func definition() -> ModuleDefinition {
    Name("TermixSSH")
    Function("mobileSyncCapability") { MobileCloud.capability() }
    AsyncFunction("fetchMobileSettings") { () async -> [String: String] in await MobileCloud.fetch() }
    AsyncFunction("start") { (config: String) in try self.engine.start(config) }
    AsyncFunction("poll") { (id: String) in self.engine.poll(id) }
    AsyncFunction("trust") { (id: String, accept: Bool) in try self.engine.trust(id, accept: accept) }
    AsyncFunction("write") { (id: String, data: String) in try self.engine.write(id, text: data) }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("resize") { (id: String, cols: Int, rows: Int) in try self.engine.resize(id, cols: cols, rows: rows) }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("disconnect") { (id: String) in self.engine.disconnect(id) }
    AsyncFunction("awsProfileKey") { (region: String, profile: String) -> String in
      var error: NSError?
      let result = MobilesshAWSProfileKey(region, profile, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("loginAWS") { (region: String, credentials: String) -> String in
      var error: NSError?
      let result = MobilesshLoginAWS(region, credentials, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("authorizeEKS") { (raw: String, credentials: String) -> String in
      var error: NSError?
      let result = MobilesshAuthorizeEKS(raw, credentials, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("selectKubeAWSProfile") { (raw: String, value: String) -> String in
      var error: NSError?
      let result = MobilesshSelectKubeAWSProfile(raw, value, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("listKubeNamespaces") { (raw: String, value: String) -> String in
      var error: NSError?
      let result = MobilesshListKubeNamespaces(raw, value, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("inspectKubeContexts") { (raw: String) -> String in
      var error: NSError?
      let result = MobilesshInspectKubeContexts(raw, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("selectKubeContext") { (raw: String, name: String) -> String in
      var error: NSError?
      let result = MobilesshSelectKubeContext(raw, name, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("inspectKubeconfig") { (raw: String) -> String in
      var error: NSError?
      let result = MobilesshInspectKubeconfig(raw, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("listKubePods") { (raw: String, namespace: String) -> String in
      var error: NSError?
      let result = MobilesshListKubePods(raw, namespace, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("listKubeResources") { (raw: String, namespace: String, kind: String) -> String in
      var error: NSError?
      let result = MobilesshListKubeResources(raw, namespace, kind, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("getKubeConfigMap") { (raw: String, namespace: String, name: String) -> String in
      var error: NSError?
      let result = MobilesshGetKubeConfigMap(raw, namespace, name, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("listKubePodMetrics") { (raw: String, namespace: String) -> String in
      var error: NSError?
      let result = MobilesshListKubePodMetrics(raw, namespace, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("getKubePodMetrics") { (raw: String, namespace: String, name: String) -> String in
      var error: NSError?
      let result = MobilesshGetKubePodMetrics(raw, namespace, name, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("getKubeScale") { (raw: String, namespace: String, kind: String, name: String) -> String in
      var error: NSError?
      let result = MobilesshGetKubeScale(raw, namespace, kind, name, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("updateKubeScale") { (raw: String, namespace: String, kind: String, name: String, payload: String) -> String in
      var error: NSError?
      let result = MobilesshUpdateKubeScale(raw, namespace, kind, name, payload, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("getKubePodContainers") { (raw: String, namespace: String, name: String) -> String in
      var error: NSError?
      let result = MobilesshGetKubePodContainers(raw, namespace, name, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("getKubePodLogs") { (raw: String, namespace: String, name: String, container: String, previous: Bool) -> String in
      var error: NSError?
      let result = MobilesshGetKubePodLogs(raw, namespace, name, container, previous, &error)
      if let error { throw error }
      return result
    }.runOnQueue(.global(qos: .userInitiated))
    AsyncFunction("clearSensitiveImportCopy") { (name: String) in
      // UIKit 匯入模式會另建 Inbox 副本；僅清理本 App 暫存區的同名檔。
      let manager = FileManager.default
      guard !name.isEmpty, name != ".", name != "..",
        !name.contains("/"), !name.contains("\\"),
        let bundleID = Bundle.main.bundleIdentifier else {
        throw NSError(domain: "TermixImport", code: 1)
      }
      let inbox = manager.temporaryDirectory.appendingPathComponent(bundleID + "-Inbox", isDirectory: true)
      let file = inbox.appendingPathComponent(name)
      guard manager.fileExists(atPath: file.path) else { return }
      guard file.resolvingSymlinksInPath().deletingLastPathComponent() == inbox.standardizedFileURL.resolvingSymlinksInPath() else {
        throw NSError(domain: "TermixImport", code: 1)
      }
      let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
      guard values.isRegularFile == true, values.isSymbolicLink != true else {
        throw NSError(domain: "TermixImport", code: 1)
      }
      do { try manager.removeItem(at: file) }
      catch { throw NSError(domain: "TermixImport", code: 1) }
    }.runOnQueue(.global(qos: .userInitiated))
    OnAppEntersBackground { self.engine.close() }
    OnDestroy { self.engine.close() }
  }
}
