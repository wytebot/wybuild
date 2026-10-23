export interface PubspecAnalysisResult {
  projectName?: string;
  version?: string;
  flutterVersionConstraint?: string;
  dependenciesCount: number;
  devDependenciesCount: number;
  warnings: Array<{ line?: number; type: 'warning' | 'error' | 'tip'; message: string }>;
  optimizations: string[];
}

export function analyzePubspec(content: string): PubspecAnalysisResult {
  const lines = content.split('\n');
  const warnings: Array<{ line?: number; type: 'warning' | 'error' | 'tip'; message: string }> = [];
  const optimizations: string[] = [];
  let projectName: string | undefined;
  let version: string | undefined;
  let flutterVersionConstraint: string | undefined;
  let inDependencies = false;
  let inDevDependencies = false;
  let depCount = 0;
  let devDepCount = 0;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const lineNum = index + 1;

    if (trimmed.startsWith('name:')) {
      projectName = trimmed.replace('name:', '').trim();
      if (!/^[a-z0-9_]+$/.test(projectName)) {
        warnings.push({
          line: lineNum,
          type: 'warning',
          message: 'Flutter package names should only contain lowercase letters, numbers, and underscores.',
        });
      }
    }

    if (trimmed.startsWith('version:')) {
      version = trimmed.replace('version:', '').trim();
      if (!version.includes('+')) {
        warnings.push({
          line: lineNum,
          type: 'tip',
          message: 'Consider appending build number format (e.g. 1.0.0+1) for Android versionCode and iOS CFBundleVersion.',
        });
      }
    }

    if (trimmed.startsWith('sdk:')) {
      flutterVersionConstraint = trimmed.replace('sdk:', '').trim();
      if (flutterVersionConstraint.includes('<3.0.0')) {
        warnings.push({
          line: lineNum,
          type: 'error',
          message: 'Dart SDK constraint requires Dart 2 legacy. Flutter 3+ requires sdk: ">=3.0.0 <4.0.0".',
        });
      }
    }

    if (trimmed === 'dependencies:') {
      inDependencies = true;
      inDevDependencies = false;
      return;
    }

    if (trimmed === 'dev_dependencies:') {
      inDependencies = false;
      inDevDependencies = true;
      return;
    }

    if (trimmed === 'flutter:' || (line.startsWith(' ') === false && trimmed.endsWith(':'))) {
      inDependencies = false;
      inDevDependencies = false;
    }

    if (inDependencies && line.startsWith('  ') && trimmed.includes(':') && !trimmed.startsWith('#')) {
      depCount++;
      const [pkg, ver] = trimmed.split(':').map((s) => s.trim());
      if (ver === 'any' || ver === '') {
        warnings.push({
          line: lineNum,
          type: 'warning',
          message: `Package "${pkg}" uses unpinned version "any". Always specify explicit version constraints to prevent breaking builds.`,
        });
      }
    }

    if (inDevDependencies && line.startsWith('  ') && trimmed.includes(':') && !trimmed.startsWith('#')) {
      devDepCount++;
    }
  });

  if (depCount > 35) {
    optimizations.push(`High package count (${depCount} dependencies). Consider modularizing plugins to decrease DEX method count and APK size.`);
  }

  optimizations.push('Enable R8 full mode in android/gradle.properties: android.enableR8.fullMode=true');
  optimizations.push('Use `--split-per-abi` in release builds to cut individual user download size by up to 60%.');

  return {
    projectName,
    version,
    flutterVersionConstraint,
    dependenciesCount: depCount,
    devDependenciesCount: devDepCount,
    warnings,
    optimizations,
  };
}

export interface PermissionAuditItem {
  permission: string;
  level: 'normal' | 'dangerous' | 'restricted';
  description: string;
  playStoreDeclarationRequired: boolean;
  recommendation: string;
}

export const PERMISSION_DATABASE: Record<string, { level: 'normal' | 'dangerous' | 'restricted'; description: string; playStoreDeclarationRequired: boolean; recommendation: string }> = {
  'android.permission.INTERNET': {
    level: 'normal',
    description: 'Allows applications to open network sockets.',
    playStoreDeclarationRequired: false,
    recommendation: 'Safe standard permission required for API access.',
  },
  'android.permission.ACCESS_FINE_LOCATION': {
    level: 'dangerous',
    description: 'Access precise GPS coordinates.',
    playStoreDeclarationRequired: true,
    recommendation: 'Request ACCESS_COARSE_LOCATION first if high precision is not strictly required. Prompt runtime dialog with rationale.',
  },
  'android.permission.ACCESS_BACKGROUND_LOCATION': {
    level: 'restricted',
    description: 'Access location in background when app is closed.',
    playStoreDeclarationRequired: true,
    recommendation: 'Google Play requires strict declaration form and review approval. Only request if core feature.',
  },
  'android.permission.CAMERA': {
    level: 'dangerous',
    description: 'Required to access the camera hardware.',
    playStoreDeclarationRequired: false,
    recommendation: 'Provide explanatory fallback if user denies permission. Declare android:required="false" in uses-feature if optional.',
  },
  'android.permission.MANAGE_EXTERNAL_STORAGE': {
    level: 'restricted',
    description: 'All-files access on Android 11+.',
    playStoreDeclarationRequired: true,
    recommendation: 'HIGH REJECTION RISK. Prefer Scoped Storage (MediaStore API or Storage Access Framework) unless you are a file manager/antivirus.',
  },
  'android.permission.RECORD_AUDIO': {
    level: 'dangerous',
    description: 'Allows application to record audio.',
    playStoreDeclarationRequired: false,
    recommendation: 'Include microphone privacy policy and rationale disclosure.',
  },
  'android.permission.QUERY_ALL_PACKAGES': {
    level: 'restricted',
    description: 'Query all installed apps on device.',
    playStoreDeclarationRequired: true,
    recommendation: 'Use targeted <queries> intent filters in AndroidManifest instead of querying all apps to pass Google Play review.',
  },
};

export function analyzeAndroidManifest(manifestXml: string): {
  permissions: PermissionAuditItem[];
  hasCleartextTraffic: boolean;
  hasBackupEnabled: boolean;
  securityScore: number;
} {
  const permissions: PermissionAuditItem[] = [];
  const regex = /<uses-permission[^>]+android:name="([^"]+)"/g;
  let match;

  while ((match = regex.exec(manifestXml)) !== null) {
    const permName = match[1];
    const info = PERMISSION_DATABASE[permName] || {
      level: 'normal',
      description: 'Standard Android permission',
      playStoreDeclarationRequired: false,
      recommendation: 'Review usage in Android 13+ runtime permission model.',
    };
    permissions.push({
      permission: permName,
      ...info,
    });
  }

  const hasCleartextTraffic = manifestXml.includes('android:usesCleartextTraffic="true"');
  const hasBackupEnabled = !manifestXml.includes('android:allowBackup="false"');

  let score = 100;
  if (hasCleartextTraffic) score -= 25;
  const restrictedCount = permissions.filter((p) => p.level === 'restricted').length;
  const dangerousCount = permissions.filter((p) => p.level === 'dangerous').length;
  score -= restrictedCount * 20;
  score -= dangerousCount * 5;

  return {
    permissions,
    hasCleartextTraffic,
    hasBackupEnabled,
    securityScore: Math.max(10, Math.min(100, score)),
  };
}

export function generateKeystoreCommand(params: {
  keystoreName: string;
  alias: string;
  validityYears: number;
  commonName: string;
  organization: string;
  city: string;
  state: string;
  countryCode: string;
}): { command: string; keyProperties: string; gradleSnippet: string } {
  const dname = `CN=${params.commonName}, OU=Mobile, O=${params.organization}, L=${params.city}, S=${params.state}, C=${params.countryCode}`;
  const validityDays = params.validityYears * 365;

  const command = `keytool -genkey -v -keystore ${params.keystoreName}.jks -keyalg RSA -keysize 2048 -validity ${validityDays} -alias ${params.alias} -dname "${dname}"`;

  const keyProperties = `storePassword=YOUR_SECURE_PASSWORD
keyPassword=YOUR_SECURE_PASSWORD
keyAlias=${params.alias}
storeFile=../${params.keystoreName}.jks`;

  const gradleSnippet = `// android/app/build.gradle
android {
    ...
    signingConfigs {
        release {
            def keystoreProperties = new Properties()
            def keystorePropertiesFile = rootProject.file('key.properties')
            if (keystorePropertiesFile.exists()) {
                keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
            }
            keyAlias = keystoreProperties['keyAlias']
            keyPassword = keystoreProperties['keyPassword']
            storeFile = keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null
            storePassword = keystoreProperties['storePassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}`;

  return { command, keyProperties, gradleSnippet };
}

export function generateProGuardRules(selectedPlugins: string[]): string {
  let rules = `# Generated ProGuard & R8 Optimization Rules for Flutter
# Keep Flutter engine internals
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.**  { *; }
-keep class io.flutter.util.**  { *; }
-keep class io.flutter.view.**  { *; }
-keep class io.flutter.**  { *; }
-keep class io.flutter.plugins.**  { *; }
-dontwarn io.flutter.embedding.**
-ignorewarnings
`;

  if (selectedPlugins.includes('firebase')) {
    rules += `
# Firebase & Google Play Services
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**
`;
  }

  if (selectedPlugins.includes('sqflite')) {
    rules += `
# SQFLite Database
-keep class com.tekartik.sqflite.** { *; }
`;
  }

  if (selectedPlugins.includes('flutterwave')) {
    rules += `
# Flutterwave v4 SDK
-keep class com.flutterwave.** { *; }
-dontwarn com.flutterwave.**
`;
  }

  if (selectedPlugins.includes('webview')) {
    rules += `
# WebView Flutter
-keepattributes *Annotation*
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
`;
  }

  return rules;
}
