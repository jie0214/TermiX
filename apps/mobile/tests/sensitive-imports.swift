import Foundation

@main struct SensitiveImportTest {
  static func main() throws {
    let manager = FileManager.default
    let root = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let cache = root.appendingPathComponent("DocumentPicker")
    try manager.createDirectory(at: cache, withIntermediateDirectories: true)
    defer { try? manager.removeItem(at: root) }
    let source = root.appendingPathComponent("original.pem")
    try Data("synthetic-secret".utf8).write(to: source)
    try manager.copyItem(at: source, to: cache.appendingPathComponent("residue.pem"))
    try manager.createSymbolicLink(at: cache.appendingPathComponent("link.pem"), withDestinationURL: source)
    try SensitiveImports.cleanDirectory(cache)
    let remaining = try manager.contentsOfDirectory(atPath: cache.path)
    precondition(remaining.isEmpty)
    precondition(manager.fileExists(atPath: source.path))
    let linked = root.appendingPathComponent("linked-cache")
    try manager.createSymbolicLink(at: linked, withDestinationURL: cache)
    do { try SensitiveImports.cleanDirectory(linked); fatalError("不應接受連結目錄") }
    catch { precondition(manager.fileExists(atPath: source.path)) }
    print("PASS：清除殘留副本且保留來源；拒絕連結目錄")
  }
}
