import Foundation
import NitroModules

/// iOS gives apps no global key hook; a hardware scanner types into the focused text field, and the
/// billing search box already treats "digits + Return" as a scan (onSubmitEditing). So on iOS this
/// object reports inactive and `start` is a no-op rather than a fake.
class HybridHidScanner: HybridHidScannerSpec {
  var isActive: Bool { false }
  func start(onScan: @escaping (String, Double) -> Void, maxGapMs: Double, minLength: Double) throws {}
  func stop() throws {}
}
