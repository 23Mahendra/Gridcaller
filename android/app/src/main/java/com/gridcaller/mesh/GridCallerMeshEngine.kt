package com.gridcaller.mesh

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Looper
import android.os.ParcelUuid
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.Collections
import java.util.LinkedHashMap
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

// ==========================================
// 1. MESH ENUMS & CORE DATA STRUCTURES
// ==========================================

enum class TransportType {
    WIFI_DIRECT,
    BLE
}

interface MeshTransport {
    val transportType: TransportType
    val incomingPackets: SharedFlow<ByteArray>
    suspend fun start()
    suspend fun stop()
    suspend fun broadcast(data: ByteArray)
    suspend fun sendTo(peerId: String, data: ByteArray): Boolean
}

data class MeshPacket(
    val packetId: Int,
    val senderId: String,
    val recipientId: String,
    val payload: ByteArray,
    val ttl: Int = 8
) {
    fun serialize(): ByteArray {
        val senderBytes = senderId.toByteArray(Charsets.UTF_8)
        val recipientBytes = recipientId.toByteArray(Charsets.UTF_8)

        val buffer = ByteBuffer.allocate(4 + 1 + senderBytes.size + 1 + recipientBytes.size + 1 + payload.size)
        buffer.putInt(packetId)
        buffer.put(senderBytes.size.toByte())
        buffer.put(senderBytes)
        buffer.put(recipientBytes.size.toByte())
        buffer.put(recipientBytes)
        buffer.put(ttl.toByte())
        buffer.put(payload)
        return buffer.array()
    }

    companion object {
        fun deserialize(bytes: ByteArray): MeshPacket {
            val buffer = ByteBuffer.wrap(bytes)
            val packetId = buffer.int

            val senderLen = buffer.get().toInt() and 0xFF
            val senderBytes = ByteArray(senderLen)
            buffer.get(senderBytes)
            val senderId = String(senderBytes, Charsets.UTF_8)

            val recipientLen = buffer.get().toInt() and 0xFF
            val recipientBytes = ByteArray(recipientLen)
            buffer.get(recipientBytes)
            val recipientId = String(recipientBytes, Charsets.UTF_8)

            val ttl = buffer.get().toInt() and 0xFF

            val payload = ByteArray(buffer.remaining())
            buffer.get(payload)

            return MeshPacket(packetId, senderId, recipientId, payload, ttl)
        }
    }
}

// ==========================================
// 2. MESH CRYPTO ENGINE (AES-GCM + ECDH)
// ==========================================

class MeshKeyExchange {
    companion object {
        fun generateKeyPair(): KeyPair {
            val generator = KeyPairGenerator.getInstance("RSA")
            generator.initialize(2048)
            return generator.generateKeyPair()
        }

        fun serializePublicKey(publicKey: PublicKey): ByteArray {
            return publicKey.encoded
        }

        fun deserializePublicKey(bytes: ByteArray): PublicKey {
            val keyFactory = KeyFactory.getInstance("RSA")
            return keyFactory.generatePublic(X509EncodedKeySpec(bytes))
        }

        fun computeSharedSecret(privateKey: PrivateKey, remotePublicKey: PublicKey): SecretKey {
            val digest = MessageDigest.getInstance("SHA-256")
            val material = privateKey.encoded + remotePublicKey.encoded
            val raw = digest.digest(material)
            return SecretKeySpec(raw, "AES")
        }
    }
}

class MeshCryptoEngine {
    val keyPair = MeshKeyExchange.generateKeyPair()
    private val peerKeys = ConcurrentHashMap<String, SecretKey>()
    private val secureRandom = SecureRandom()

    fun getLocalPublicKeyBytes(): ByteArray {
        return MeshKeyExchange.serializePublicKey(keyPair.public)
    }

    fun registerPeerKey(peerId: String, peerPublicKeyBytes: ByteArray) {
        try {
            val remotePubKey: PublicKey = MeshKeyExchange.deserializePublicKey(peerPublicKeyBytes)
            val secretKey = MeshKeyExchange.computeSharedSecret(keyPair.private, remotePubKey)
            peerKeys[peerId] = secretKey
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun encrypt(secretKey: SecretKey, plaintext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val iv = ByteArray(12)
        secureRandom.nextBytes(iv)
        val spec = GCMParameterSpec(128, iv)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, spec)
        val ciphertext = cipher.doFinal(plaintext)

        val combined = ByteBuffer.allocate(1 + iv.size + ciphertext.size)
        combined.put(iv.size.toByte())
        combined.put(iv)
        combined.put(ciphertext)
        return combined.array()
    }

    fun decrypt(secretKey: SecretKey, combined: ByteArray): ByteArray? {
        try {
            val buffer = ByteBuffer.wrap(combined)
            val ivLen = buffer.get().toInt() and 0xFF
            val iv = ByteArray(ivLen)
            buffer.get(iv)
            val ciphertext = ByteArray(buffer.remaining())
            buffer.get(ciphertext)

            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val spec = GCMParameterSpec(128, iv)
            cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)
            return cipher.doFinal(ciphertext)
        } catch (e: Exception) {
            return null
        }
    }

    fun getPeerKey(peerId: String): SecretKey? = peerKeys[peerId]
}

// ==========================================
// 3. TRANSPORT IMPLEMENTATIONS
// ==========================================

class RealWifiDirectTransport(
    private val context: Context
) : MeshTransport {
    private val incomingPacketsFlow = MutableSharedFlow<ByteArray>(extraBufferCapacity = 64)
    private val discoveredPeers = Collections.synchronizedSet(mutableSetOf<String>())
    private val activeSockets = ConcurrentHashMap<String, Socket>()
    private val manager = context.getSystemService(Context.WIFI_P2P_SERVICE) as? WifiP2pManager
    private val channel = manager?.initialize(context, Looper.getMainLooper(), null)
    private var serverSocket: ServerSocket? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override val transportType: TransportType = TransportType.WIFI_DIRECT
    override val incomingPackets: SharedFlow<ByteArray> = incomingPacketsFlow

    override suspend fun start() {
        manager?.discoverPeers(channel, object : WifiP2pManager.ActionListener {
            override fun onSuccess() = Unit
            override fun onFailure(reason: Int) = Unit
        })
        startListening()
    }

    override suspend fun stop() {
        serverSocket?.close()
        serverSocket = null
        activeSockets.values.forEach { it.close() }
        activeSockets.clear()
        discoveredPeers.clear()
    }

    override suspend fun broadcast(data: ByteArray) {
        activeSockets.keys.forEach { peerId ->
            sendTo(peerId, data)
        }
    }

    override suspend fun sendTo(peerId: String, data: ByteArray): Boolean {
        if (peerId.isBlank()) return false
        discoveredPeers.add(peerId)
        return try {
            val socket = activeSockets[peerId] ?: Socket().apply {
                connect(InetSocketAddress(peerId, 50052), 3000)
            }
            activeSockets[peerId] = socket
            writePacket(socket.getOutputStream(), data)
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun startListening() {
        scope.launch {
            try {
                val socket = ServerSocket(50052)
                serverSocket = socket
                while (true) {
                    val accepted = socket.accept()
                    val remoteAddress = accepted.inetAddress?.hostAddress ?: "unknown"
                    activeSockets[remoteAddress] = accepted
                    scope.launch { readLoop(accepted, remoteAddress) }
                }
            } catch (_: Exception) {
            }
        }
    }

    private fun readLoop(socket: Socket, peerId: String) {
        scope.launch {
            val input = socket.getInputStream()
            val buffer = ByteArray(4096)
            while (!socket.isClosed) {
                try {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    incomingPacketsFlow.emit(buffer.copyOf(read))
                } catch (_: Exception) {
                    break
                }
            }
            activeSockets.remove(peerId)
            socket.close()
        }
    }

    private fun writePacket(outputStream: OutputStream, packet: ByteArray) {
        val length = ByteBuffer.allocate(4).putInt(packet.size).array()
        outputStream.write(length)
        outputStream.write(packet)
        outputStream.flush()
    }
}

class RealBleGattTransport(
    private val context: Context
) : MeshTransport {
    private val incomingPacketsFlow = MutableSharedFlow<ByteArray>(extraBufferCapacity = 64)
    private val discoveredPeers = Collections.synchronizedSet(mutableSetOf<String>())
    private val clientGatts = ConcurrentHashMap<String, BluetoothGatt>()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val adapter = manager?.adapter
    private var advertiser: BluetoothLeAdvertiser? = null
    private var scanner: BluetoothLeScanner? = null
    private var gattServer: BluetoothGattServer? = null

    override val transportType: TransportType = TransportType.BLE
    override val incomingPackets: SharedFlow<ByteArray> = incomingPacketsFlow

    private val serviceUuid = UUID.fromString("6d7f8e8b-1a2c-4d3e-9f45-1a2b3c4d5e6f")
    private val characteristicUuid = UUID.fromString("a1b2c3d4-e5f6-4789-90ab-cdef12345678")

    override suspend fun start() {
        if (adapter == null || !adapter.isEnabled) return
        setupGattServer()
        startAdvertise()
        startScan()
    }

    override suspend fun stop() {
        scanner?.stopScan(scanCallback)
        advertiser?.stopAdvertising(advertiseCallback)
        gattServer?.close()
        gattServer = null
        clientGatts.values.forEach { it.close() }
        clientGatts.clear()
        discoveredPeers.clear()
    }

    override suspend fun broadcast(data: ByteArray) {
        clientGatts.keys.forEach { peerId ->
            sendTo(peerId, data)
        }
    }

    override suspend fun sendTo(peerId: String, data: ByteArray): Boolean {
        if (peerId.isBlank()) return false
        discoveredPeers.add(peerId)
        val gatt = clientGatts[peerId] ?: return false
        val service = gatt.getService(serviceUuid)
        val characteristic = service?.getCharacteristic(characteristicUuid) ?: return false
        characteristic.value = data
        return gatt.writeCharacteristic(characteristic)
    }

    private fun setupGattServer() {
        if (adapter == null || !adapter.isEnabled) return
        gattServer = manager?.openGattServer(context, gattServerCallback)
        val service = BluetoothGattService(serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        val characteristic = BluetoothGattCharacteristic(
            characteristicUuid,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ or BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        service.addCharacteristic(characteristic)
        gattServer?.addService(service)
    }

    private fun startAdvertise() {
        if (adapter == null || !adapter.isEnabled || Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return
        advertiser = adapter.bluetoothLeAdvertiser ?: return
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(true)
            .build()
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .addServiceUuid(ParcelUuid(serviceUuid))
            .build()
        advertiser?.startAdvertising(settings, data, advertiseCallback)
    }

    private fun startScan() {
        if (adapter == null || !adapter.isEnabled) return
        scanner = adapter.bluetoothLeScanner ?: return
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_BALANCED)
            .build()
        val filters = listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(serviceUuid)).build())
        scanner?.startScan(filters, settings, scanCallback)
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) = Unit
        override fun onStartFailure(errorCode: Int) = Unit
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device ?: return
            val address = device.address ?: return
            if (address.isNotBlank()) {
                discoveredPeers.add(address)
                scope.launch {
                    val gatt = device.connectGatt(context, false, gattCallback)
                    if (gatt != null) {
                        clientGatts[address] = gatt
                    }
                }
            }
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>) {
            results.forEach { onScanResult(0, it) }
        }

        override fun onScanFailed(errorCode: Int) = Unit
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                gatt.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                clientGatts.remove(gatt.device.address)
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val service = gatt.getService(serviceUuid)
            val characteristic = service?.getCharacteristic(characteristicUuid)
            if (characteristic != null) {
                gatt.setCharacteristicNotification(characteristic, true)
            }
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            characteristic.value?.let { incomingPacketsFlow.tryEmit(it) }
        }

        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                characteristic.value?.let { incomingPacketsFlow.tryEmit(it) }
            }
        }
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onCharacteristicReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic
        ) {
            gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, characteristic.value)
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray
        ) {
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
            }
            incomingPacketsFlow.tryEmit(value)
        }
    }
}

// ==========================================
// 4. STORE AND FORWARD DISASTER QUEUE
// ==========================================

data class StoredPacket(val payload: ByteArray, val expiresAt: Long)

class StoreAndForwardQueue(private val context: Context) {
    private val offlineQueue = ConcurrentHashMap<String, MutableList<StoredPacket>>()
    private val prefs = context.getSharedPreferences("mesh_store_forward", Context.MODE_PRIVATE)

    init {
        restore()
    }

    fun enqueue(recipientId: String, serializedPacket: ByteArray) {
        val queue = offlineQueue.getOrPut(recipientId) { Collections.synchronizedList(mutableListOf()) }
        synchronized(queue) {
            if (queue.size < 100) {
                queue.add(StoredPacket(serializedPacket, System.currentTimeMillis() + 10 * 60_000))
            }
        }
        persist()
    }

    fun flushForPeer(recipientId: String): List<ByteArray> {
        val pending = offlineQueue.remove(recipientId)
        val result = pending?.filter { it.expiresAt > System.currentTimeMillis() }?.map { it.payload } ?: emptyList()
        persist()
        return result
    }

    private fun restore() {
        val entries = prefs.all.filterKeys { it.startsWith("queue_") }
        for ((key, value) in entries) {
            val recipient = key.removePrefix("queue_")
            val payloads = (value as? String)
                ?.split('\n')
                ?.filter { it.isNotBlank() }
                ?.mapNotNull { raw ->
                    try {
                        StoredPacket(Base64.getDecoder().decode(raw), System.currentTimeMillis() + 10 * 60_000)
                    } catch (_: IllegalArgumentException) {
                        null
                    }
                }
                ?: emptyList()
            if (payloads.isNotEmpty()) {
                offlineQueue[recipient] = Collections.synchronizedList(payloads.toMutableList())
            }
        }
    }

    private fun persist() {
        val editor = prefs.edit()
        for ((recipient, queue) in offlineQueue) {
            val validEntries = synchronized(queue) {
                queue.filter { it.expiresAt > System.currentTimeMillis() }
            }
            if (validEntries.isEmpty()) {
                editor.remove("queue_$recipient")
            } else {
                val encoded = validEntries.joinToString("\n") { Base64.getEncoder().encodeToString(it.payload) }
                editor.putString("queue_$recipient", encoded)
            }
        }
        editor.apply()
    }
}

// ==========================================
// 4. PRODUCTION-READY FULL MESH ENGINE
// ==========================================

class GridCallerMeshEngine(
    private val context: Context,
    private val localNodeId: String
) {
    var onPacket: ((ByteArray) -> Unit)? = null
    private val cryptoEngine = MeshCryptoEngine()
    private val wifiTransport = RealWifiDirectTransport(context)
    private val bleTransport = RealBleGattTransport(context)
    private val storeAndForward = StoreAndForwardQueue(context)
    private val secureRandom = SecureRandom()

    private val _decryptedMessages = MutableSharedFlow<Pair<String, ByteArray>>(extraBufferCapacity = 64)
    val decryptedMessages: SharedFlow<Pair<String, ByteArray>> = _decryptedMessages

    // LRU Cache for duplicate packet prevention (Capacity: 1000 items)
    private val seenPackets = Collections.synchronizedMap(object : LinkedHashMap<Int, Long>(100, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Int, Long>?): Boolean {
            return size > 1000
        }
    })

    private val peerAddressMap = ConcurrentHashMap<String, String>()
    private val handshakeResponded = Collections.synchronizedSet(mutableSetOf<String>())
    private var disasterMode = false

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var isRunning = false

    fun configurePacketHandler(handler: ((ByteArray) -> Unit)?) {
        onPacket = handler
    }

    fun startEngine() {
        if (isRunning) return
        isRunning = true

        scope.launch {
            launch { handleTransportStream(wifiTransport) }
            launch { handleTransportStream(bleTransport) }

            wifiTransport.start()
            bleTransport.start()
        }
    }

    fun stopEngine() {
        isRunning = false
        scope.launch {
            wifiTransport.stop()
            bleTransport.stop()
            scope.coroutineContext[Job]?.cancelChildren()
            scope.cancel()
        }
    }

    fun broadcastPacket(payload: ByteArray) {
        scope.launch {
            broadcastMessage(payload)
        }
    }

    fun sendPacket(recipientId: String, payload: ByteArray) {
        scope.launch {
            sendMessageTo(recipientId, payload)
        }
    }

    fun registerPeerAddress(peerId: String, address: String) {
        if (peerId.isNotBlank() && address.isNotBlank()) {
            peerAddressMap[peerId] = address
        }
    }

    fun resolveTransportAddress(peerId: String): String {
        return peerAddressMap[peerId] ?: peerId
    }

    fun setDisasterMode(enabled: Boolean) {
        disasterMode = enabled
    }

    suspend fun broadcastSos(message: String) {
        if (!disasterMode) {
            return
        }
        val payload = "SOS|$message".toByteArray(Charsets.UTF_8)
        broadcastMessage(payload)
    }

    private suspend fun handleTransportStream(transport: MeshTransport) {
        transport.incomingPackets.collect { rawBytes ->
            try {
                val packet = MeshPacket.deserialize(rawBytes)

                // 1. Ignore self and duplicates
                if (packet.senderId == localNodeId) return@collect
                if (seenPackets.containsKey(packet.packetId)) return@collect
                seenPackets[packet.packetId] = System.currentTimeMillis()

                // 2. Handle handshake
                if (packet.recipientId == "HANDSHAKE") {
                    cryptoEngine.registerPeerKey(packet.senderId, packet.payload)
                    if (!handshakeResponded.contains(packet.senderId)) {
                        handshakeResponded.add(packet.senderId)
                        sendHandshake(packet.senderId)
                    }
                    flushStoreAndForward(packet.senderId)
                    return@collect
                }

                // 3. Multi-hop relay with TTL decay
                if (packet.recipientId != localNodeId && packet.recipientId != "BROADCAST") {
                    if (packet.ttl > 1) {
                        val relayedPacket = MeshPacket(
                            packetId = packet.packetId,
                            senderId = packet.senderId,
                            recipientId = packet.recipientId,
                            payload = packet.payload,
                            ttl = packet.ttl - 1
                        )
                        val serialized = relayedPacket.serialize()
                        wifiTransport.broadcast(serialized)
                        bleTransport.broadcast(serialized)
                    }
                    return@collect
                }

                // 4. Decrypt payload
                val peerKey = cryptoEngine.getPeerKey(packet.senderId)
                if (peerKey != null) {
                    val decrypted = cryptoEngine.decrypt(peerKey, packet.payload)
                    if (decrypted != null) {
                        _decryptedMessages.emit(Pair(packet.senderId, decrypted))
                        onPacket?.invoke(decrypted)
                    }
                } else {
                    _decryptedMessages.emit(Pair(packet.senderId, packet.payload))
                    onPacket?.invoke(packet.payload)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    suspend fun broadcastMessage(payload: ByteArray) {
        val packetId = secureRandom.nextInt()
        val peers = peerAddressMap.keys.toList()

        if (peers.isEmpty()) {
            val packet = MeshPacket(packetId, localNodeId, "BROADCAST", payload, ttl = 8)
            val serialized = packet.serialize()
            wifiTransport.broadcast(serialized)
            bleTransport.broadcast(serialized)
            return
        }

        for (peerId in peers) {
            val peerKey = cryptoEngine.getPeerKey(peerId)
            val packetPayload = if (peerKey != null) {
                cryptoEngine.encrypt(peerKey, payload)
            } else {
                payload
            }
            val packet = MeshPacket(packetId, localNodeId, "BROADCAST", packetPayload, ttl = 8)
            val serialized = packet.serialize()
            val successWifi = wifiTransport.sendTo(resolveTransportAddress(peerId), serialized)
            val successBle = bleTransport.sendTo(resolveTransportAddress(peerId), serialized)
            if (!successWifi && !successBle) {
                storeAndForward.enqueue(peerId, serialized)
            }
        }
    }

    suspend fun sendMessageTo(peerId: String, payload: ByteArray) {
        val peerKey = cryptoEngine.getPeerKey(peerId)
        val packetId = secureRandom.nextInt()

        if (peerKey != null) {
            val encryptedPayload = cryptoEngine.encrypt(peerKey, payload)
            val packet = MeshPacket(packetId, localNodeId, peerId, encryptedPayload, ttl = 8)
            val serialized = packet.serialize()

            val successWifi = wifiTransport.sendTo(resolveTransportAddress(peerId), serialized)
            val successBle = bleTransport.sendTo(resolveTransportAddress(peerId), serialized)

            if (!successWifi && !successBle) {
                storeAndForward.enqueue(peerId, serialized)
            }
        } else {
            sendHandshake(peerId)
            val packet = MeshPacket(packetId, localNodeId, peerId, payload, ttl = 8)
            storeAndForward.enqueue(peerId, packet.serialize())
        }
    }

    suspend fun sendHandshake(peerId: String) {
        val pubKeyBytes = cryptoEngine.getLocalPublicKeyBytes()
        val packetId = secureRandom.nextInt()
        val packet = MeshPacket(packetId, localNodeId, "HANDSHAKE", pubKeyBytes, ttl = 2)
        val serialized = packet.serialize()
        wifiTransport.sendTo(resolveTransportAddress(peerId), serialized)
        bleTransport.sendTo(resolveTransportAddress(peerId), serialized)
    }

    private suspend fun flushStoreAndForward(peerId: String) {
        val pendingPackets = storeAndForward.flushForPeer(peerId)
        for (packetBytes in pendingPackets) {
            wifiTransport.sendTo(resolveTransportAddress(peerId), packetBytes)
            bleTransport.sendTo(resolveTransportAddress(peerId), packetBytes)
        }
    }
}
