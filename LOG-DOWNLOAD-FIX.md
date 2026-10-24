# Full build-log download fix

- The download action exports `logs` (the complete build log array), independent of search text and All/Errors/Warnings filters.
- In a native Capacitor APK, the `.txt` file is written persistently to the device's Documents directory using `@capacitor/filesystem`; it is not left only in a temporary Blob URL or app cache.
- The Android share/save sheet is offered after the file is written, so users can also copy it to Downloads, Drive, or another app. Dismissing the sheet does not delete the saved file.
- In browsers, the text file is downloaded with a delayed Blob URL revocation to avoid cancelling downloads on mobile.
- The button shows a busy state and a success/error message.

Validation note: source-level change only. A device build/download was not run in this environment; verify on an installed APK and confirm the file is visible in the device's Documents/files view.
