import CoreBluetooth
import Foundation
import NitroModules

/// iOS cannot open classic SPP without MFi, so iOS talks to BLE thermal printers: scan, connect,
/// find the first characteristic that accepts writes, and stream bytes into it in MTU-sized chunks.
/// `address` is the CBPeripheral identifier UUID. Not exercised on a device yet (no Mac in this
/// build environment) — the Android path is the tested one.
class HybridBluetoothPrinter: HybridBluetoothPrinterSpec {
  private let delegate = Central()

  var isEnabled: Bool { delegate.manager.state == .poweredOn }
  var connectedAddress: String? { delegate.characteristic == nil ? nil : delegate.peripheral?.identifier.uuidString }

  func listPaired() throws -> Promise<[PrinterDevice]> {
    return Promise.async { try await self.delegate.scan(seconds: 4) }
  }

  func connect(address: String, timeoutMs: Double) throws -> Promise<Void> {
    return Promise.async { try await self.delegate.connect(address, timeout: timeoutMs / 1000) }
  }

  func write(data: ArrayBuffer, chunkBytes: Double, gapMs: Double) throws -> Promise<Void> {
    let bytes = data.toData(copyIfNeeded: true)
    return Promise.async { try await self.delegate.write(bytes, chunk: Int(chunkBytes), gapMs: gapMs) }
  }

  func disconnect() throws { delegate.disconnect() }
}

private final class Central: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  lazy var manager = CBCentralManager(delegate: self, queue: nil)
  var peripheral: CBPeripheral?
  var characteristic: CBCharacteristic?
  private var found: [UUID: CBPeripheral] = [:]
  private var ready: CheckedContinuation<Void, Error>?

  func centralManagerDidUpdateState(_ central: CBCentralManager) {}

  @MainActor func scan(seconds: Double) async throws -> [PrinterDevice] {
    guard manager.state == .poweredOn else { throw NSError(domain: "printer", code: 1, userInfo: [NSLocalizedDescriptionKey: "Bluetooth is off"]) }
    found.removeAll()
    manager.scanForPeripherals(withServices: nil)
    try await Task.sleep(nanoseconds: UInt64(seconds * 1e9))
    manager.stopScan()
    return found.values.compactMap { p in p.name.map { PrinterDevice(address: p.identifier.uuidString, name: $0) } }
  }

  func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
    found[p.identifier] = p
  }

  @MainActor func connect(_ address: String, timeout: Double) async throws {
    guard let id = UUID(uuidString: address), let p = manager.retrievePeripherals(withIdentifiers: [id]).first ?? found[id] else {
      throw NSError(domain: "printer", code: 2, userInfo: [NSLocalizedDescriptionKey: "Printer not found — scan again"])
    }
    peripheral = p
    p.delegate = self
    try await withThrowingTaskGroup(of: Void.self) { group in
      group.addTask { @MainActor in
        try await withCheckedThrowingContinuation { (k: CheckedContinuation<Void, Error>) in
          self.ready = k
          self.manager.connect(p)
        }
      }
      group.addTask {
        try await Task.sleep(nanoseconds: UInt64(timeout * 1e9))
        throw NSError(domain: "printer", code: 3, userInfo: [NSLocalizedDescriptionKey: "Printer did not answer"])
      }
      try await group.next()
      group.cancelAll()
    }
  }

  func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) { p.discoverServices(nil) }
  func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
    ready?.resume(throwing: error ?? NSError(domain: "printer", code: 4)); ready = nil
  }
  func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
    for s in p.services ?? [] { p.discoverCharacteristics(nil, for: s) }
  }
  func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
    guard characteristic == nil else { return }
    if let w = s.characteristics?.first(where: { $0.properties.contains(.writeWithoutResponse) || $0.properties.contains(.write) }) {
      characteristic = w
      ready?.resume(); ready = nil
    }
  }

  @MainActor func write(_ data: Data, chunk: Int, gapMs: Double) async throws {
    guard let p = peripheral, let ch = characteristic else {
      throw NSError(domain: "printer", code: 5, userInfo: [NSLocalizedDescriptionKey: "Printer is not connected"])
    }
    let type: CBCharacteristicWriteType = ch.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
    let size = max(20, min(chunk, p.maximumWriteValueLength(for: type)))
    var i = 0
    while i < data.count {
      let end = min(i + size, data.count)
      p.writeValue(data.subdata(in: i..<end), for: ch, type: type)
      i = end
      if gapMs > 0 { try await Task.sleep(nanoseconds: UInt64(gapMs * 1e6)) }
    }
  }

  func disconnect() {
    if let p = peripheral { manager.cancelPeripheralConnection(p) }
    peripheral = nil; characteristic = nil
  }
}
