package com.leaflet.app

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import app.tauri.Logger
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Seals the sign-in (the Leaflet session token, the Drive refresh token) with
 * an AES-256-GCM key made inside the Android Keystore; the key never leaves
 * it. The Rust side (`sync/device_secret.rs`) keeps the files and calls
 * [seal] and [open] by JNI, from any thread, once [attach] has told it where
 * this class is. A failure answers null, and Rust then keeps the secret in
 * Leaflet's private storage unsealed, as before: never a lost sign-in.
 *
 * Sealed bytes: the IV's length (one byte), the IV, the ciphertext and tag.
 */
object SecretBox {
  private const val STORE = "AndroidKeyStore"
  private const val ALIAS = "leaflet-secrets"
  private const val TRANSFORM = "AES/GCM/NoPadding"
  private const val TAG_BITS = 128

  /** Hands this class to Rust. Called before the Rust app starts (MainActivity). */
  @JvmStatic
  external fun attach()

  @JvmStatic
  @Synchronized
  fun seal(plain: ByteArray): ByteArray? {
    return try {
      val cipher = Cipher.getInstance(TRANSFORM)
      cipher.init(Cipher.ENCRYPT_MODE, key(create = true))
      val iv = cipher.iv
      byteArrayOf(iv.size.toByte()) + iv + cipher.doFinal(plain)
    } catch (error: Exception) {
      Logger.error("SecretBox could not seal: ${error.javaClass.simpleName}: ${error.message}")
      null
    }
  }

  @JvmStatic
  @Synchronized
  fun open(sealed: ByteArray): ByteArray? {
    return try {
      val ivLength = if (sealed.isEmpty()) 0 else sealed[0].toInt()
      if (ivLength < 12 || ivLength > 16 || sealed.size <= 1 + ivLength) {
        return null
      }
      // No key (a backup restored to another phone, app data cleared): nothing to open with.
      val key = key(create = false) ?: return null
      val cipher = Cipher.getInstance(TRANSFORM)
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, sealed, 1, ivLength))
      cipher.doFinal(sealed, 1 + ivLength, sealed.size - 1 - ivLength)
    } catch (error: Exception) {
      Logger.error("SecretBox could not open: ${error.javaClass.simpleName}: ${error.message}")
      null
    }
  }

  private fun key(create: Boolean): SecretKey? {
    val store = KeyStore.getInstance(STORE).apply { load(null) }
    (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    if (!create) {
      return null
    }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, STORE)
    generator.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return generator.generateKey()
  }
}
