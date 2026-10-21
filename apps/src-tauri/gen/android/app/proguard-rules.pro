# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
# SecretBox is called from Rust by JNI (sync/device_secret.rs): its name and
# its seal/open methods must survive shrinking.
-keep class com.leaflet.app.SecretBox {
  public static *** seal(byte[]);
  public static *** open(byte[]);
  public static native void attach();
}

# The Studio voice (StudioVoice.kt): sherpa-onnx's JNI library reads its config
# classes' fields by name and calls back into the Kotlin lambda it is given
# (com/k2fsa/sherpa/onnx/Tts.kt), so none of it may be renamed or removed.
-keep class com.k2fsa.sherpa.onnx.** { *; }
-keep interface kotlin.jvm.functions.Function1 { *; }
-keepclassmembers class * implements kotlin.jvm.functions.Function1 {
  public java.lang.Object invoke(java.lang.Object);
}
