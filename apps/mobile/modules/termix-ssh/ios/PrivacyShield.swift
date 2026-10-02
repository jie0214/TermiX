import UIKit

// 在原生失去前景通知同步遮蔽所有 Scene，避免等待 JS 後才遮蔽系統快照。
final class PrivacyShield {
  static let shared = PrivacyShield()
  private var observers: [NSObjectProtocol] = []
  private var covers: [UIWindow] = []

  func start() {
    guard observers.isEmpty else { return }
    let center = NotificationCenter.default
    for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification,
                 UIScene.willDeactivateNotification, UIScene.didEnterBackgroundNotification] {
      observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.show() })
    }
    observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.hide() })
    observers.append(center.addObserver(forName: UIScene.didActivateNotification, object: nil, queue: .main) { [weak self] _ in self?.hide() })
    if UIApplication.shared.applicationState != .active { show() }
  }

  private func show() {
    for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
      guard !covers.contains(where: { $0.windowScene === scene }) else { continue }
      scene.windows.forEach { $0.endEditing(true) }
      let cover = UIWindow(windowScene: scene)
      cover.windowLevel = UIWindow.Level(rawValue: UIWindow.Level.alert.rawValue + 1)
      let controller = UIViewController()
      controller.view.backgroundColor = .systemBackground
      cover.rootViewController = controller
      cover.isHidden = false
      covers.append(cover)
    }
  }

  private func hide() {
    covers.removeAll { cover in
      guard cover.windowScene?.activationState == .foregroundActive else { return false }
      cover.isHidden = true
      return true
    }
  }
}
