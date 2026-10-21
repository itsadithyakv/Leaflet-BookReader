import java.security.MessageDigest
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Release signing with the owner's upload key, when (and only when)
// gen/android/keystore.properties exists. It is git-ignored; see
// keystore.properties.example beside it and docs/android.md, "Signing for
// Google Play". Without it a release build is left unsigned.
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}
val signingKeys = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
if (keystorePropertiesFile.exists()) {
    val missing = signingKeys.filter { keystoreProperties.getProperty(it).isNullOrBlank() }
    if (missing.isNotEmpty()) {
        throw GradleException("keystore.properties is missing ${missing.joinToString()}.")
    }
}

android {
    compileSdk = 36
    namespace = "com.leaflet.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.leaflet.app"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("upload") {
                // Absolute, or relative to gen/android.
                val store = rootProject.file(keystoreProperties.getProperty("storeFile"))
                if (!store.isFile) {
                    throw GradleException("keystore.properties names a storeFile that is not there.")
                }
                storeFile = store
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("upload")
            }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
    // The Studio voice's native code (StudioVoice.kt), from vendor/ (see below):
    // arm64 for every debug build, x86_64 too for the emulator's; release
    // builds only with LEAFLET_STUDIO_VOICE=1. Each flavor's abiFilters keep
    // only its own ABI, so a build carries one ABI's copy.
    sourceSets {
        getByName("debug").jniLibs.srcDirs(sherpaDir.resolve("arm64-v8a"), sherpaDir.resolve("x86_64"))
        if (studioVoiceInRelease) getByName("release").jniLibs.srcDir(sherpaDir.resolve("arm64-v8a"))
    }
}

// ---- the Studio voice's native libraries -----------------------------------
// sherpa-onnx 1.13.8 and its ONNX Runtime, out of the official AAR by
// msix/fetch-sherpa-onnx.ps1 into gen/android/vendor/ (git-ignored): nothing
// is downloaded by the build. Every build checks them against these SHA-256s
// (the script's list); without them the app builds with no Studio voice.
// sherpa-onnx 1.x compiles espeak-ng (GPL-3.0) in, so a release build leaves
// them out unless LEAFLET_STUDIO_VOICE=1 (or -PstudioVoice=true): not for the
// Store before sherpa-onnx 2.0 (docs/android.md, "Studio voice").
val sherpaDir: File get() = rootProject.file("vendor/sherpa-onnx-1.13.8")
val studioVoiceInRelease: Boolean get() =
    System.getenv("LEAFLET_STUDIO_VOICE") == "1" || (findProperty("studioVoice") as? String) == "true"
val sherpaLibs = mapOf(
    "arm64-v8a/arm64-v8a/libonnxruntime.so" to "33847ad43bffe204699fd4a27f7f3603452a8cdaf2f9a44983a0bc31ffcf2da1",
    "arm64-v8a/arm64-v8a/libsherpa-onnx-jni.so" to "3c6492ea91ea68fd3b72b9495efdde6dd913f6b58c387e3b07389cf335f4d26f",
    "x86_64/x86_64/libonnxruntime.so" to "087e84297cad64acb823c3d901d6e0cc934e91add7cdb20da802cd1c0bea5c3e",
    "x86_64/x86_64/libsherpa-onnx-jni.so" to "1dc24c88fb364f1022a5217b70ab3bc3c9cae3120ae2e1ed358e1f68ed120b04",
)
val verifyStudioVoiceLibs by tasks.registering {
    description = "Checks the vendored sherpa-onnx libraries against their SHA-256s."
    val root = sherpaDir
    val expected = sherpaLibs
    inputs.files(expected.keys.map { root.resolve(it) }.filter { it.isFile })
    doLast {
        val missing = mutableListOf<String>()
        for ((path, sha) in expected) {
            val file = root.resolve(path)
            if (!file.isFile) {
                missing.add(path)
                continue
            }
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(1 shl 16)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                }
            }
            val got = digest.digest().joinToString("") { "%02x".format(it) }
            if (got != sha) throw GradleException("vendor/sherpa-onnx-1.13.8/$path is not the expected file (SHA-256 $got). Run msix/fetch-sherpa-onnx.ps1 again.")
        }
        if (missing.any { it.startsWith("arm64") }) {
            logger.lifecycle("Studio voice: no sherpa-onnx libraries in vendor/ (msix/fetch-sherpa-onnx.ps1); building without it.")
        }
    }
}
tasks.named("preBuild") { dependsOn(verifyStudioVoiceLibs) }

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    // Google Play's in-app review (DevicePlugin.requestReview).
    implementation("com.google.android.play:review:2.0.2")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")