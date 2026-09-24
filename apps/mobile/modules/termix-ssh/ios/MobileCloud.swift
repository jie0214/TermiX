import CloudKit
import Foundation

// CloudKit 僅接收桌面的一般設定；不接觸手機憑證。
enum MobileCloud {
  private static func accountStatus(_ container: CKContainer) async throws -> CKAccountStatus {
    try await withCheckedThrowingContinuation { continuation in
      let request = AccountRequest(continuation)
      DispatchQueue.global().asyncAfter(deadline: .now() + 15) {
        request.finish(.failure(CKError(.networkFailure)))
      }
      container.accountStatus { status, error in
        if let error { request.finish(.failure(error)) }
        else { request.finish(.success(status)) }
      }
    }
  }

  // iOS 由系統驗證 App 簽章；發佈流程另外核對實際 entitlement。
  static func capability() -> String {
    guard let identifier = Bundle.main.object(forInfoDictionaryKey: "TermixCloudKitContainer") as? String,
          identifier.hasPrefix("iCloud."),
          let environment = Bundle.main.object(forInfoDictionaryKey: "TermixCloudKitEnvironment") as? String,
          ["Development", "Production"].contains(environment) else { return "not_configured" }
    return "available"
  }

  static func fetch() async -> [String: String] {
    guard let identifier = Bundle.main.object(forInfoDictionaryKey: "TermixCloudKitContainer") as? String,
          identifier.hasPrefix("iCloud.") else { return ["status": "not_configured"] }
    guard capability() == "available" else { return ["status": "not_configured"] }
    let container = CKContainer(identifier: identifier)
    do {
      guard try await accountStatus(container) == .available else { return ["status": "no_account"] }
      let database = container.privateCloudDatabase
      let record: CKRecord = try await withCheckedThrowingContinuation { continuation in
        let operation = CKFetchRecordsOperation(recordIDs: [CKRecord.ID(recordName: "desktop-settings-v1")])
        operation.configuration.timeoutIntervalForRequest = 15
        operation.configuration.timeoutIntervalForResource = 25
        let lock = NSLock()
        var fetched: Result<CKRecord, Error>?
        operation.perRecordResultBlock = { _, result in
          lock.lock(); fetched = result; lock.unlock()
        }
        operation.fetchRecordsResultBlock = { result in
          lock.lock(); let recordResult = fetched; lock.unlock()
          if let recordResult { continuation.resume(with: recordResult) }
          else if case .failure(let error) = result { continuation.resume(throwing: error) }
          else { continuation.resume(throwing: CKError(.unknownItem)) }
        }
        database.add(operation)
      }
      guard let payload = record["payload"] as? String, payload.utf8.count <= 262144 else { return ["status": "invalid"] }
      return ["status": "ok", "payload": payload]
    } catch let error as CKError {
      if error.code == .unknownItem { return ["status": "empty"] }
      if error.code == .notAuthenticated { return ["status": "no_account"] }
      return ["status": "network"]
    } catch { return ["status": "network"] }
  }
}

// 帳號查詢與期限競爭時，只恢復一次；較晚的系統回應不觸發資料讀取。
private final class AccountRequest {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<CKAccountStatus, Error>?
  init(_ continuation: CheckedContinuation<CKAccountStatus, Error>) { self.continuation = continuation }
  func finish(_ result: Result<CKAccountStatus, Error>) {
    lock.lock()
    let pending = continuation
    continuation = nil
    lock.unlock()
    pending?.resume(with: result)
  }
}
