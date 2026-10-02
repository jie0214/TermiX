import Foundation

// 僅清理 App 自己的檔案選擇器副本；不遍歷來源、子目錄或符號連結。
enum SensitiveImports {
  static func cleanDirectory(_ directory: URL) throws {
    let manager = FileManager.default
    guard manager.fileExists(atPath: directory.path) else { return }
    guard try directory.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else {
      throw NSError(domain: "TermixImport", code: 1)
    }
    for file in try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey]) {
      let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
      // 移除連結本身，不跟隨連結刪除來源。
      guard values.isRegularFile == true || values.isSymbolicLink == true else {
        throw NSError(domain: "TermixImport", code: 1)
      }
      try manager.removeItem(at: file)
    }
  }

  static func clean() throws {
    let manager = FileManager.default
    guard let bundle = Bundle.main.bundleIdentifier,
      let cache = manager.urls(for: .cachesDirectory, in: .userDomainMask).first,
      let documents = manager.urls(for: .documentDirectory, in: .userDomainMask).first else {
      throw NSError(domain: "TermixImport", code: 1)
    }
    do {
      for directory in [cache.appendingPathComponent("DocumentPicker"),
                        manager.temporaryDirectory.appendingPathComponent(bundle + "-Inbox"),
                        documents.appendingPathComponent("Inbox")] {
        try cleanDirectory(directory)
      }
    } catch { throw NSError(domain: "TermixImport", code: 1) }
  }
}
