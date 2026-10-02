import UIKit

// 獨立的模擬器測試 App，只顯示公開測試文字，不讀取 TermiX 資料。
@main final class PrivacyTestApp: UIResponder, UIApplicationDelegate {
  func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
    let config = UISceneConfiguration(name: "Test", sessionRole: session.role)
    config.delegateClass = PrivacyTestScene.self
    return config
  }
}
final class PrivacyTestScene: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  var tested = false
  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: scene)
    let controller = UIViewController()
    controller.view.backgroundColor = .red
    window.rootViewController = controller
    self.window = window
    window.makeKeyAndVisible()
  }
  func sceneDidBecomeActive(_ scene: UIScene) {
    guard !tested, let scene = scene as? UIWindowScene else { return }
    tested = true
    DispatchQueue.main.async {
      PrivacyShield.shared.start()
      NotificationCenter.default.post(name: UIScene.willDeactivateNotification, object: scene)
      let covers = scene.windows.filter { !$0.isHidden && $0.windowLevel > .alert }
      let covered = covers.count == 1 && covers[0].rootViewController?.view.backgroundColor == .systemBackground
      NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
      let noDuplicates = scene.windows.filter { !$0.isHidden && $0.windowLevel > .alert }.count == 1
      NotificationCenter.default.post(name: UIScene.didActivateNotification, object: scene)
      let restored = scene.windows.filter { !$0.isHidden && $0.windowLevel > .alert }.isEmpty
      let result = covered && noDuplicates && restored ? "PASS" : "FAIL"
      let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("privacy-result.txt")
      try? result.write(to: file, atomically: true, encoding: .utf8)
    }
  }
}
