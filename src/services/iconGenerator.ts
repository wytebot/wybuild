import JSZip from 'jszip';

export interface IconPreset {
  folder: string;
  filename: string;
  size: number;
}

export const ANDROID_ICON_PRESETS: IconPreset[] = [
  { folder: 'res/mipmap-mdpi', filename: 'ic_launcher.png', size: 48 },
  { folder: 'res/mipmap-hdpi', filename: 'ic_launcher.png', size: 72 },
  { folder: 'res/mipmap-xhdpi', filename: 'ic_launcher.png', size: 96 },
  { folder: 'res/mipmap-xxhdpi', filename: 'ic_launcher.png', size: 144 },
  { folder: 'res/mipmap-xxxhdpi', filename: 'ic_launcher.png', size: 192 },
  { folder: 'web', filename: 'favicon.png', size: 32 },
  { folder: 'playstore', filename: 'playstore-icon.png', size: 512 },
];

export async function resizeImageToBlob(
  sourceImage: HTMLImageElement,
  size: number,
  paddingPercent: number = 0,
  backgroundColor: string = 'transparent',
  rounded: boolean = false
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  ctx.clearRect(0, 0, size, size);

  if (backgroundColor !== 'transparent') {
    ctx.fillStyle = backgroundColor;
    if (rounded) {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, size, size);
    }
  }

  const padding = (size * paddingPercent) / 100;
  const drawSize = size - padding * 2;
  const offset = padding;

  if (rounded && backgroundColor === 'transparent') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(sourceImage, offset, offset, drawSize, drawSize);
    ctx.restore();
  } else {
    ctx.drawImage(sourceImage, offset, offset, drawSize, drawSize);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to generate canvas blob'));
    }, 'image/png');
  });
}

export async function generateAndroidIconZip(
  sourceImage: HTMLImageElement,
  paddingPercent: number = 0,
  backgroundColor: string = '#0284c7',
  rounded: boolean = false
): Promise<{ zipBlob: Blob; fileCount: number }> {
  const zip = new JSZip();

  for (const preset of ANDROID_ICON_PRESETS) {
    const blob = await resizeImageToBlob(sourceImage, preset.size, paddingPercent, backgroundColor, rounded);
    zip.file(`${preset.folder}/${preset.filename}`, blob);

    // Also generate round variant for Android 7.1+
    if (preset.folder.startsWith('res/mipmap-')) {
      const roundBlob = await resizeImageToBlob(sourceImage, preset.size, paddingPercent, backgroundColor, true);
      zip.file(`${preset.folder}/ic_launcher_round.png`, roundBlob);
    }
  }

  // Add Android 8.0+ Adaptive Icon XML files
  const adaptiveIconXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>`;

  const backgroundColorsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${backgroundColor}</color>
</resources>`;

  zip.file('res/mipmap-anydpi-v26/ic_launcher.xml', adaptiveIconXml);
  zip.file('res/mipmap-anydpi-v26/ic_launcher_round.xml', adaptiveIconXml);
  zip.file('res/values/ic_launcher_background.xml', backgroundColorsXml);

  // Add flutter_launcher_icons.yaml config snippet
  const yamlConfig = `# Add this to your Flutter project's pubspec.yaml
dev_dependencies:
  flutter_launcher_icons: ^0.13.1

flutter_launcher_icons:
  android: "launcher_icon"
  ios: true
  image_path: "assets/icon/icon.png"
  min_sdk_android: 21
  adaptive_icon_background: "${backgroundColor}"
  adaptive_icon_foreground: "assets/icon/icon_foreground.png"
`;
  zip.file('flutter_launcher_icons_guide.yaml', yamlConfig);

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  return { zipBlob, fileCount: ANDROID_ICON_PRESETS.length + 4 };
}
