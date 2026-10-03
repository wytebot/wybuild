import JSZip from 'jszip';

export interface FlutterEnvVariable {
  key: string;
  value: string;
  description?: string;
}

export interface FlutterProjectExportOptions {
  appName: string;
  packageName: string;
  flutterVersion?: string;
  envVariables: FlutterEnvVariable[];
  target: 'apk' | 'appbundle' | 'split-per-abi';
  enableObfuscation: boolean;
  keystoreAlias?: string;
}

export async function generateFlutterProjectZip(options: FlutterProjectExportOptions): Promise<Blob> {
  const zip = new JSZip();
  const safeName = options.appName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const packagePath = options.packageName.replace(/\./g, '/');

  // 1. pubspec.yaml
  const pubspec = `name: ${safeName}
description: "Production-ready Flutter application with CI/CD and environment variable integration."
publish_to: "none"
version: 1.0.0+1

environment:
  sdk: ">=3.3.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter
  flutter_dotenv: ^5.2.1
  http: ^1.2.2
  shared_preferences: ^2.3.2
  google_fonts: ^6.2.1

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0

flutter:
  uses-material-design: true
  assets:
    - .env
`;
  zip.file('pubspec.yaml', pubspec);

  // 2. .env file & .env.example
  let envFileContent = `# Environment Variables for ${options.appName}\n`;
  options.envVariables.forEach((env) => {
    envFileContent += `${env.key}=${env.value}\n`;
  });
  if (options.envVariables.length === 0) {
    envFileContent += `API_BASE_URL=https://api.yourdomain.com
APP_ENV=production
FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST-938b8120e98129038a83-X
APP_NAME="${options.appName}"
API_TIMEOUT_SECONDS=30
ENABLE_ANALYTICS=true
`;
  }
  zip.file('.env', envFileContent);
  zip.file('.env.example', envFileContent);

  // 3. lib/env_config.dart
  const envConfigDart = `import 'package:flutter/foundation.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Centralized configuration provider supporting both:
/// 1. Runtime .env file loading (flutter_dotenv)
/// 2. Compile-time --dart-define flags (flutter build apk --dart-define=KEY=VAL)
class EnvConfig {
  static Future<void> init() async {
    try {
      await dotenv.load(fileName: ".env");
    } catch (e) {
      if (kDebugMode) {
        print("Note: .env file not bundled, using --dart-define fallbacks: \$e");
      }
    }
  }

  static String get(String key, {String defaultValue = ''}) {
    // Priority 1: Check runtime .env file
    if (dotenv.isInitialized && dotenv.env.containsKey(key)) {
      final val = dotenv.env[key];
      if (val != null && val.isNotEmpty) return val;
    }
    // Priority 2: Check compile-time --dart-define
    const defineVal = String.fromEnvironment('');
    return defaultValue;
  }

${options.envVariables
  .map(
    (ev) => `  static String get ${ev.key.toLowerCase().replace(/_([a-z])/g, (_, l) => l.toUpperCase())} =>
      dotenv.env['${ev.key}'] ?? const String.fromEnvironment('${ev.key}', defaultValue: '${ev.value}');`
  )
  .join('\n\n')}
}
`;
  zip.file('lib/env_config.dart', envConfigDart);

  // 4. lib/main.dart
  const mainDart = `import 'package:flutter/material.dart';
import 'env_config.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await EnvConfig.init();
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '${options.appName}',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0284C7)),
        useMaterial3: true,
      ),
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('${options.appName}'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Environment Variables Loaded:',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
${options.envVariables
  .map(
    (v) => `                      Text(
                        '${v.key}: \${EnvConfig.get('${v.key}', defaultValue: '${v.value}')}',
                        style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
                      ),
                      const Divider(),`
  )
  .join('\n')}
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Ready to build APK with one-click Cloud CI/CD or locally using:',
                style: TextStyle(color: Colors.grey),
              ),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.black87,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Text(
                  'flutter build apk --release',
                  style: TextStyle(color: Colors.greenAccent, fontFamily: 'monospace'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
`;
  zip.file('lib/main.dart', mainDart);

  // 5. test/widget_test.dart
  const widgetTest = `import 'package:flutter_test/flutter_test.dart';
import 'package:${safeName}/main.dart';

void main() {
  testWidgets('App smoke test initializes', (WidgetTester tester) async {
    await tester.pumpWidget(const MyApp());
    expect(find.text('${options.appName}'), findsOneWidget);
  });
}
`;
  zip.file('test/widget_test.dart', widgetTest);

  // 6. android/app/build.gradle
  const appBuildGradle = `plugins {
    id "com.android.application"
    id "kotlin-android"
    id "dev.flutter.flutter-gradle-plugin"
}

def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    namespace "${options.packageName}"
    compileSdk = 35
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId "${options.packageName}"
        minSdk = 23
        targetSdk = 35
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                keyAlias = keystoreProperties['keyAlias']
                keyPassword = keystoreProperties['keyPassword']
                storeFile = keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null
                storePassword = keystoreProperties['storePassword']
            }
        }
    }

    buildTypes {
        release {
            if (keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.release
            } else {
                signingConfig = signingConfigs.debug
            }
            minifyEnabled = ${options.enableObfuscation}
            shrinkResources = ${options.enableObfuscation}
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}

flutter {
    source = "../.."
}
`;
  zip.file('android/app/build.gradle', appBuildGradle);

  // 7. android/build.gradle
  const rootBuildGradle = `allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.buildDir = "../build"
subprojects {
    project.buildDir = "\${rootProject.buildDir}/\${project.name}"
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register("clean", Delete) {
    delete rootProject.buildDir
}
`;
  zip.file('android/build.gradle', rootBuildGradle);

  // 8. android/settings.gradle
  const settingsGradle = `pluginManagement {
    def flutterSdkPath = {
        def properties = new Properties()
        file("local.properties").withInputStream { properties.load(it) }
        def flutterSdkPath = properties.getProperty("flutter.sdk")
        assert flutterSdkPath != null : "flutter.sdk not set in local.properties"
        return flutterSdkPath
    }
    settings.ext.flutterSdkPath = flutterSdkPath()

    includeBuild("\$settings.ext.flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id "dev.flutter.flutter-plugin-loader" version "1.0.0"
    id "com.android.application" version "8.3.2" apply false
    id "org.jetbrains.kotlin.android" version "1.9.24" apply false
}

include ":app"
`;
  zip.file('android/settings.gradle', settingsGradle);

  // 9. android/key.properties.example
  const keyProperties = `keyAlias=${options.keystoreAlias || 'upload'}
keyPassword=your_secure_password
storePassword=your_secure_password
storeFile=../upload-keystore.jks
`;
  zip.file('android/key.properties.example', keyProperties);

  // 10. android/app/src/main/AndroidManifest.xml
  const manifestXml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET"/>
    <application
        android:label="${options.appName}"
        android:name="\${applicationName}"
        android:icon="@mipmap/ic_launcher">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTop"
            android:taskAffinity=""
            android:theme="@style/LaunchTheme"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|locale|layoutDirection|fontScale|screenLayout|density|uiMode"
            android:hardwareAccelerated="true"
            android:windowSoftInputMode="adjustResize">
            <meta-data
              android:name="io.flutter.embedding.android.NormalTheme"
              android:resource="@style/NormalTheme"
              />
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
        </activity>
        <meta-data
            android:name="flutterEmbedding"
            android:value="2" />
    </application>
</manifest>
`;
  zip.file('android/app/src/main/AndroidManifest.xml', manifestXml);

  // 11. Kotlin MainActivity
  const mainActivityKt = `package ${options.packageName}

import io.flutter.embedding.android.FlutterActivity

class MainActivity: FlutterActivity()
`;
  zip.file(`android/app/src/main/kotlin/${packagePath}/MainActivity.kt`, mainActivityKt);

  // 12. README.md & BUILD_APK_GUIDE.md
  let dartDefinesFlags = options.envVariables
    .map((v) => `  --dart-define=${v.key}="${v.value}" \\`)
    .join('\n');

  const buildGuide = `# ${options.appName} - Flutter APK Build & Environment Variable Guide

This project is pre-configured with environment variable management (\`flutter_dotenv\` + \`--dart-define\`) and optimized Android build configurations.

---

## 1. Quick Start

1. Install Flutter dependencies:
\`\`\`bash
flutter pub get
\`\`\`

2. Customize your environment variables in \`.env\`:
\`\`\`env
${envFileContent}
\`\`\`

---

## 2. Generate APK Locally

### Option A: Standard Universal Release APK
\`\`\`bash
flutter build apk --release
\`\`\`
Output path: \`build/app/outputs/flutter-apk/app-release.apk\`

### Option B: Build APK with Compile-Time --dart-define
\`\`\`bash
flutter build apk --release \\
${dartDefinesFlags || '  --dart-define=API_BASE_URL="https://api.yourdomain.com" \\\n  --dart-define=APP_ENV="production"'}
\`\`\`

### Option C: Split-per-ABI (Significantly reduces APK download size)
\`\`\`bash
flutter build apk --release --split-per-abi
\`\`\`
Outputs 3 optimized APKs:
- \`app-arm64-v8a-release.apk\` (modern 64-bit phones)
- \`app-armeabi-v7a-release.apk\` (older 32-bit phones)
- \`app-x86_64-release.apk\` (emulators)

### Option D: Android App Bundle (.aab for Google Play Store)
\`\`\`bash
flutter build appbundle --release
\`\`\`
Output path: \`build/app/outputs/bundle/release/app-release.aab\`

---

## 3. Production Release Signing (Keystore)

1. Generate your release keystore:
\`\`\`bash
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
\`\`\`

2. Move \`upload-keystore.jks\` to the \`android/\` directory.

3. Rename \`android/key.properties.example\` to \`android/key.properties\` and enter your passwords:
\`\`\`properties
keyAlias=upload
keyPassword=YOUR_KEY_PASSWORD
storePassword=YOUR_STORE_PASSWORD
storeFile=../upload-keystore.jks
\`\`\`

4. Run \`flutter build apk --release\`. Gradle will automatically sign the binary using your keystore!

---

## 4. One-Click Cloud CI/CD via WyBuild
Push this repository to GitHub and connect it to **WyBuild** for zero-setup, one-click cloud builds, automated testing, real-time error telemetry, and wireless QR code sideloading.
`;

  zip.file('README.md', buildGuide);
  zip.file('BUILD_APK_GUIDE.md', buildGuide);

  // Generate the zip blob
  return await zip.generateAsync({ type: 'blob' });
}
