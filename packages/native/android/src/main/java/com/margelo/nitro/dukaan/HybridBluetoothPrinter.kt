package com.margelo.nitro.dukaan

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import java.io.IOException
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Classic Bluetooth SPP (RFCOMM). All I/O runs on one dedicated thread so writes from two print
 * jobs can never interleave on the socket.
 */
@Keep
@DoNotStrip
@SuppressLint("MissingPermission") // BLUETOOTH_CONNECT is requested from JS before any call.
class HybridBluetoothPrinter : HybridBluetoothPrinterSpec() {
  private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "dukaan-printer").apply { isDaemon = true } }
  private var socket: BluetoothSocket? = null
  private var out: OutputStream? = null
  private var address: String? = null

  private val adapter: BluetoothAdapter?
    get() {
      val ctx = NitroModules.applicationContext ?: return null
      return (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
    }

  override val isEnabled: Boolean
    get() = adapter?.isEnabled == true

  override val connectedAddress: String?
    get() = if (socket?.isConnected == true) address else null

  override fun listPaired(): Promise<Array<PrinterDevice>> = Promise.async {
    val a = adapter ?: throw IllegalStateException("This phone has no Bluetooth")
    if (!a.isEnabled) throw IllegalStateException("Bluetooth is off")
    a.bondedDevices.orEmpty()
      .map { PrinterDevice(it.address, it.name ?: it.address) }
      .sortedBy { it.name.lowercase() }
      .toTypedArray()
  }

  override fun connect(address: String, timeoutMs: Double): Promise<Unit> = Promise.async {
    val a = adapter ?: throw IllegalStateException("This phone has no Bluetooth")
    if (!a.isEnabled) throw IllegalStateException("Bluetooth is off")
    val task = io.submit {
      if (this.address == address && socket?.isConnected == true) return@submit
      closeQuietly()
      a.cancelDiscovery() // discovery slows RFCOMM connects to a crawl
      val device = a.getRemoteDevice(address)
      val s = try {
        device.createRfcommSocketToServiceRecord(SPP).also { it.connect() }
      } catch (first: IOException) {
        // Many cheap printers only answer on the insecure channel.
        try { device.createInsecureRfcommSocketToServiceRecord(SPP).also { it.connect() } } catch (_: IOException) { throw first }
      }
      socket = s
      out = s.outputStream
      this.address = address
    }
    try {
      task.get(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
    } catch (e: TimeoutException) {
      task.cancel(true)
      io.submit { closeQuietly() }
      throw IOException("Printer did not answer in ${timeoutMs.toLong()} ms — is it on and in range?")
    } catch (e: java.util.concurrent.ExecutionException) {
      throw e.cause ?: e
    }
  }

  override fun write(data: ArrayBuffer, chunkBytes: Double, gapMs: Double): Promise<Unit> {
    // Copy on the JS thread: the ArrayBuffer may be owned by JS and must not be read off-thread.
    val bytes = data.toByteArray()
    val chunk = chunkBytes.toInt().coerceAtLeast(16)
    val gap = gapMs.toLong().coerceAtLeast(0)
    return Promise.async {
      try {
        io.submit {
          val o = out ?: throw IOException("Printer is not connected")
          var i = 0
          while (i < bytes.size) {
            val n = minOf(chunk, bytes.size - i)
            o.write(bytes, i, n)
            o.flush()
            i += n
            if (gap > 0 && i < bytes.size) Thread.sleep(gap)
          }
        }.get()
      } catch (e: java.util.concurrent.ExecutionException) {
        io.submit { closeQuietly() } // a broken pipe means the printer went away; force a reconnect
        throw e.cause ?: e
      }
    }
  }

  override fun disconnect() {
    io.submit { closeQuietly() }
  }

  private fun closeQuietly() {
    try { out?.close() } catch (_: IOException) {}
    try { socket?.close() } catch (_: IOException) {}
    out = null
    socket = null
    address = null
  }

  private fun ArrayBuffer.toByteArray(): ByteArray {
    val buf = getBuffer(false).duplicate()
    buf.rewind()
    return ByteArray(buf.remaining()).also { buf.get(it) }
  }

  companion object {
    /** Serial Port Profile — the service every ESC/POS Bluetooth printer exposes. */
    private val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
  }
}
